import { optionalStringArray, requireString } from "./agent-tool-args";
import type { AgentToolContext, AgentToolDeps } from "./agent-tools";
import { ConnectorGrantsService, type ConnectorGrantLimits } from "./composio/connector-grants";
import type { JsonRecord } from "./provider-http";

/** Company connector visibility for any agent: what is connected, who holds it. */
export function listConnectorsTool(deps: AgentToolDeps, ctx: AgentToolContext): string {
  const grantsService = new ConnectorGrantsService(deps.db);
  const accounts = grantsService.activeAccounts(ctx.orgId);
  if (accounts.length === 0) {
    return "The company has no connected external toolkits yet. The board connects them on the Connectors page.";
  }
  const grants = grantsService.grantsForOrg(ctx.orgId);
  const agentNames = new Map(
    (deps.db.prepare("select id, name from agents where org_id = ?").all(ctx.orgId) as Array<{ id: string; name: string }>)
      .map((row) => [row.id, row.name]),
  );
  const lines = accounts.map((account) => {
    const holders = grants
      .filter((grant) => grant.toolkitSlug === account.toolkitSlug && grant.accountLabel === account.label)
      .map((grant) => `${agentNames.get(grant.agentId)}${limitNote(grant.limits)}`);
    return `- ${account.toolkitName} (${account.toolkitSlug}), account "${account.label}": ${holders.length > 0 ? `granted to ${holders.join(", ")}` : "no grants yet"}`;
  });
  return ["Connected toolkits:", ...lines].join("\n");
}

/** CEO-only: hand a connected toolkit to a teammate, or take it back. */
export function grantConnectorTool(deps: AgentToolDeps, ctx: AgentToolContext, args: JsonRecord, mode: "grant" | "revoke"): string {
  const acting = deps.db.prepare("select role_level from agents where id = ? and org_id = ?")
    .get(ctx.agent.id, ctx.orgId) as { role_level: string } | undefined;
  if (acting?.role_level !== "c_suite") {
    return "ERROR: Only the CEO can manage connector grants. Ask them to run this.";
  }
  const agentName = requireString(args.agent_name, "agent_name");
  const toolkit = requireString(args.toolkit, "toolkit");
  const target = deps.db.prepare(
    "select id, name from agents where org_id = ? and lower(name) = lower(?) and lifecycle = 'active' limit 1",
  ).get(ctx.orgId, agentName) as { id: string; name: string } | undefined;
  if (!target) return `ERROR: No active agent named "${agentName}".`;
  const grantsService = new ConnectorGrantsService(deps.db);
  if (mode === "grant") {
    const label = grantsService.grant({
      orgId: ctx.orgId,
      agentId: target.id,
      toolkitSlug: toolkit,
      accountLabel: args.account === undefined ? null : requireString(args.account, "account"),
      limits: {
        actions: args.actions === undefined ? null : optionalStringArray(args.actions, "actions"),
        fixedArguments: args.fixed_arguments === undefined ? null : requireObject(args.fixed_arguments, "fixed_arguments"),
      },
      grantedByType: "agent",
      grantedById: ctx.agent.id,
    });
    return `${target.name} now has access to the ${toolkit.toLowerCase()} connector through its "${label}" account${limitText(args)}; its tools join their next run.`;
  }
  grantsService.revoke({ orgId: ctx.orgId, agentId: target.id, toolkitSlug: toolkit });
  return `${target.name} no longer has access to the ${toolkit.toLowerCase()} connector.`;
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length === 0) {
    throw new Error(`"${field}" must be an object of argument values.`);
  }
  return value as Record<string, unknown>;
}

function limitText(args: JsonRecord): string {
  return limitNote({
    actions: Array.isArray(args.actions) ? args.actions.map((action) => String(action).trim().toUpperCase()) : null,
    fixedArguments: args.fixed_arguments === undefined ? null : args.fixed_arguments as Record<string, unknown>,
  });
}

/** A grant's limits in a few words, empty when it has none. */
function limitNote(limits: ConnectorGrantLimits): string {
  const parts = [
    ...(limits.actions ? [`only ${limits.actions.join(", ")}`] : []),
    ...(limits.fixedArguments ? [`limited to ${JSON.stringify(limits.fixedArguments)}`] : []),
  ];
  return parts.length > 0 ? ` (${parts.join("; ")})` : "";
}
