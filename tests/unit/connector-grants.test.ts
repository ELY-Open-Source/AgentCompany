import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { ConnectorGrantsService } from "../../src/main/services/composio/connector-grants";
import { dispatchAgentTool, type AgentToolContext } from "../../src/main/services/agent-tools";

function call(name: string, args: Record<string, unknown>) {
  return { id: `call_${randomUUID()}`, name, arguments: args };
}

interface Harness {
  connection: DatabaseConnection;
  orgId: string;
  ceoId: string;
  danaId: string;
  ceoCtx: AgentToolContext;
  danaCtx: AgentToolContext;
  deps: { db: DatabaseConnection["db"]; organization: OrganizationService; chat: ChatService };
}

function harness(): Harness {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-connector-${randomUUID()}.db`));
  const organization = new OrganizationService(connection.db);
  let orgId = "";
  let ceoId = "";
  let danaId = "";
  connection.transaction(() => {
    orgId = organization.createOrganization({ organizationName: "OrbitOps", employeeName: "Yang", mission: "m", goal: "g" });
    const providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
    ceoId = organization.createAgent({
      orgId, name: "CEO", role: "CEO", department: "Executive",
      modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null, roleLevel: "c_suite",
    });
    danaId = organization.createAgent({
      orgId, name: "Dana", role: "Engineer", department: "Engineering",
      modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 1000, managerAgentId: ceoId,
    });
  });
  const context = (agentId: string): AgentToolContext => ({
    orgId,
    agent: { id: agentId, modelProviderId: null, modelId: null },
    taskProjectId: null,
    taskGoalId: null, taskId: null, sourceThreadId: null,
    workspace: null,
  });
  return {
    connection,
    orgId,
    ceoId,
    danaId,
    ceoCtx: context(ceoId),
    danaCtx: context(danaId),
    deps: { db: connection.db, organization, chat: new ChatService(connection.db) },
  };
}

function connectToolkit(h: Harness, slug: string, name: string): void {
  const now = new Date().toISOString();
  h.connection.db.prepare(`
    insert into connector_accounts(id, org_id, toolkit_slug, toolkit_name, label, auth_config_id, status, created_at, updated_at)
    values (?, ?, ?, ?, 'main', ?, 'ACTIVE', ?, ?)
  `).run(`ca_${slug}`, h.orgId, slug, name, `ac_${slug}`, now, now);
}

describe("connector grants", () => {
  test("granting requires an actively connected toolkit", () => {
    const h = harness();
    const grants = new ConnectorGrantsService(h.connection.db);
    expect(() => grants.grant({
      orgId: h.orgId, agentId: h.danaId, toolkitSlug: "github", accountLabel: null, grantedByType: "employee", grantedById: null,
    })).toThrow(/No active connection/);
  });

  test("the CEO grants and revokes toolkits for teammates", () => {
    const h = harness();
    connectToolkit(h, "github", "GitHub");
    const granted = dispatchAgentTool(h.deps, h.ceoCtx, call("grant_connector", { agent_name: "Dana", toolkit: "github" }));
    expect(granted).toContain("Dana now has access to the github connector");

    const grants = new ConnectorGrantsService(h.connection.db);
    expect(grants.toolkitsForAgent(h.orgId, h.danaId)).toEqual(["github"]);
    // The CEO holds every active connection by role, without a grant row.
    expect(grants.toolkitsForAgent(h.orgId, h.ceoId)).toEqual(["github"]);

    const listing = dispatchAgentTool(h.deps, h.danaCtx, call("list_connectors", {}));
    expect(listing).toContain("GitHub (github), account \"main\": granted to Dana");

    const revoked = dispatchAgentTool(h.deps, h.ceoCtx, call("revoke_connector", { agent_name: "Dana", toolkit: "github" }));
    expect(revoked).toContain("no longer has access");
    expect(grants.toolkitsForAgent(h.orgId, h.danaId)).toEqual([]);
  });

  test("a toolkit with several accounts: grants and actions name the account", () => {
    const h = harness();
    const now = new Date().toISOString();
    for (const label of ["main", "sales"]) {
      h.connection.db.prepare(`
        insert into connector_accounts(id, org_id, toolkit_slug, toolkit_name, label, auth_config_id, status, created_at, updated_at)
        values (?, ?, 'github', 'GitHub', ?, 'ac_github', 'ACTIVE', ?, ?)
      `).run(`ca_gh_${label}`, h.orgId, label, now, now);
    }
    const grants = new ConnectorGrantsService(h.connection.db);
    expect(dispatchAgentTool(h.deps, h.ceoCtx, call("grant_connector", { agent_name: "Dana", toolkit: "github" })))
      .toBe('ERROR: "github" has several accounts (main, sales); name one with account.');
    expect(dispatchAgentTool(h.deps, h.ceoCtx, call("grant_connector", { agent_name: "Dana", toolkit: "github", account: "Sales" })))
      .toContain('through its "sales" account');
    expect(dispatchAgentTool(h.deps, h.ceoCtx, call("grant_connector", { agent_name: "Dana", toolkit: "github", account: null })))
      .toBe('ERROR: "account" is required.');
    expect(grants.accountForAgent(h.orgId, h.danaId, "github", null).id).toBe("ca_gh_sales");
    expect(() => grants.accountForAgent(h.orgId, h.danaId, "github", "main")).toThrow('Your grant for "github" is the "sales" account, not "main".');
    expect(() => grants.accountForAgent(h.orgId, h.ceoId, "github", null)).toThrow('"github" has several accounts (main, sales)');
    expect(grants.accountForAgent(h.orgId, h.ceoId, "github", "main").id).toBe("ca_gh_main");
    const listing = dispatchAgentTool(h.deps, h.danaCtx, call("list_connectors", {}));
    expect(listing).toContain('GitHub (github), account "main": no grants yet');
    expect(listing).toContain('GitHub (github), account "sales": granted to Dana');
    h.connection.db.prepare("update connector_accounts set status = 'EXPIRED' where id = 'ca_gh_sales'").run();
    expect(grants.toolkitsForAgent(h.orgId, h.danaId)).toEqual([]);
    expect(grants.toolkitsForAgent(h.orgId, h.ceoId)).toEqual(["github"]);
  });

  test("staff cannot hand out connector access", () => {
    const h = harness();
    connectToolkit(h, "github", "GitHub");
    const denied = dispatchAgentTool(h.deps, h.danaCtx, call("grant_connector", { agent_name: "Dana", toolkit: "github" }));
    expect(denied).toContain("ERROR");
    expect(new ConnectorGrantsService(h.connection.db).toolkitsForAgent(h.orgId, h.danaId)).toEqual([]);
  });

  test("a disconnected toolkit stops counting for its grants", () => {
    const h = harness();
    connectToolkit(h, "slack", "Slack");
    const grants = new ConnectorGrantsService(h.connection.db);
    grants.grant({ orgId: h.orgId, agentId: h.danaId, toolkitSlug: "slack", accountLabel: null, grantedByType: "employee", grantedById: null });
    expect(grants.toolkitsForAgent(h.orgId, h.danaId)).toEqual(["slack"]);
    h.connection.db.prepare("update connector_accounts set status = 'EXPIRED' where org_id = ? and toolkit_slug = 'slack'").run(h.orgId);
    expect(grants.toolkitsForAgent(h.orgId, h.danaId)).toEqual([]);
  });
});
