/**
 * Main-side handler for the `hire_agent` internal tool (C4 part 1/5).
 *
 * Contract: this handler accepts the exact same field shape the HTTP
 * `POST /api/companies/:id/agents` route accepts (see
 * `api-server/routes-agents.ts`) and funnels through the same
 * `db.createHireRequest` primitive + auto-approval policy so both paths
 * produce identical approval rows. The HTTP path is kept live for
 * legacy clients (see C4 part 5/5 deprecation marker); this is the
 * tool-first path the CEO prompt now advertises.
 *
 * Error policy:
 *  - Input validation fails → throw `UserInputError`. The worker's tool
 *    wrapper converts `{ ok: false, error }` into a pi tool-error
 *    result, so the CEO sees the validation message on its next turn
 *    and can correct the call.
 *  - DB write / approval layer fails → throw `UpstreamError`. Same
 *    surface behaviour, different classification for telemetry.
 *
 * No fallbacks, no silent catches: a malformed hire is a bug worth
 * surfacing to the model, not worth papering over.
 */

import type { AppDatabase } from "@main/database";
import {
  canManageOrganization,
  canRequestHire,
  getHireNameValidationError,
  getHireRoutingValidationError,
  resolveHireReportsTo,
} from "@main/agent-permissions";
import { resolveApprovalDecision } from "@main/approval-policy";
import { shouldAutoApprove } from "@main/execution-policy";
import { getConnectorExecutionReadinessIssue } from "@shared/connector-policy";
import { hireRequestSchema } from "@shared/contracts";
import { UserInputError, UpstreamError, classifyUnknownError } from "@main/errors";
import type { InvokeInternalToolRpcResult } from "@main/worker/runtime/internal-tools/internal-tool-rpc";

export interface HireAgentHandlerDeps {
  db: AppDatabase;
  onApprovalResolved: (approvalId: string, companyId: string, decision: string) => void;
  onDomainChanged: () => void;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

export interface HireAgentHandlerContext {
  companyId: string;
  agentId: string;
}

/**
 * Handle a `hire_agent` tool invocation from the worker RPC.
 *
 * Mirrors the control flow of the HTTP handler (validate → resolve
 * reportsTo → name/routing checks → connector readiness → dedup →
 * create → auto-approve) and returns the `{ agentId, approvalId,
 * autoApproved }` shape wrapped as a pi tool-result.
 */
export function handleHireAgentToolCall(
  deps: HireAgentHandlerDeps,
  ctx: HireAgentHandlerContext,
  rawArgs: unknown,
): InvokeInternalToolRpcResult {
  const { db } = deps;
  const { companyId, agentId: requesterId } = ctx;

  if (!canRequestHire(db, companyId, requesterId)) {
    throw new UserInputError({
      code: "hire_agent.permission.denied",
      message: "Current agent is not allowed to request hires.",
      context: { companyId, requesterId },
    });
  }

  const argObject = typeof rawArgs === "object" && rawArgs !== null
    ? (rawArgs as Record<string, unknown>)
    : {};
  const reportsToProvided = Object.prototype.hasOwnProperty.call(argObject, "reportsTo");

  const parsed = hireRequestSchema.safeParse({
    companyId,
    requestedByAgentId: requesterId,
    ...argObject,
  });
  if (!parsed.success) {
    throw new UserInputError({
      code: "hire_agent.input.invalid",
      message: `Invalid hire_agent payload: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
      context: { companyId, requesterId },
    });
  }
  const input = parsed.data;

  const resolvedReportsTo = resolveHireReportsTo(
    db,
    companyId,
    requesterId,
    reportsToProvided ? input.reportsTo : undefined,
    input.department ?? null,
  );

  const nameError = getHireNameValidationError({
    name: input.name,
    role: input.role,
    title: input.title,
  });
  if (nameError) {
    throw new UserInputError({
      code: "hire_agent.name.invalid",
      message: nameError,
      context: { name: input.name, role: input.role },
    });
  }

  const routingError = getHireRoutingValidationError(
    db,
    companyId,
    requesterId,
    resolvedReportsTo,
    input.department ?? null,
  );
  if (routingError) {
    throw new UserInputError({
      code: "hire_agent.routing.invalid",
      message: routingError,
      context: { resolvedReportsTo, department: input.department ?? null },
    });
  }

  if (
    resolvedReportsTo &&
    resolvedReportsTo !== requesterId &&
    !canManageOrganization(db, companyId, requesterId) &&
    !db.core.agents.getChainOfCommand(resolvedReportsTo).some((agent) => agent.id === requesterId)
  ) {
    throw new UserInputError({
      code: "hire_agent.routing.not_in_chain",
      message:
        "Requested hire must report to you or a manager in your reporting chain.",
      context: { resolvedReportsTo },
    });
  }

  const connectorRecord = (() => {
    try {
      return db.core.connectors.getConnector(input.connectorId);
    } catch (error) {
      throw new UserInputError({
        code: "hire_agent.connector.missing",
        message: `Connector ${input.connectorId} does not exist.`,
        cause: error,
      });
    }
  })();
  const connectorIssue = getConnectorExecutionReadinessIssue(connectorRecord);
  if (connectorIssue) {
    throw new UserInputError({
      code: "hire_agent.connector.not_ready",
      message: connectorIssue,
      context: { connectorId: input.connectorId },
    });
  }

  const existingAgents = db.core.agents.listExistingAgentsForHireCheck(companyId);
  const duplicateByName = existingAgents.find(
    (a) => a.name.toLowerCase() === input.name.toLowerCase(),
  );
  if (duplicateByName) {
    throw new UserInputError({
      code: "hire_agent.duplicate.existing",
      message: `Agent "${input.name}" already exists in this company (id: ${duplicateByName.id}, role: ${duplicateByName.role}). Use the existing agent instead of creating a duplicate.`,
    });
  }

  const pendingHires = db.core.approvals.listPendingHireApprovalPayloads(companyId);
  for (const pending of pendingHires) {
    try {
      const payload = pending.payloadJson ? JSON.parse(pending.payloadJson) as Record<string, unknown> : {};
      if (typeof payload.name === "string" && payload.name.toLowerCase() === input.name.toLowerCase()) {
        throw new UserInputError({
          code: "hire_agent.duplicate.pending",
          message: `A hire request for "${input.name}" is already pending approval.`,
        });
      }
    } catch (error) {
      if (error instanceof UserInputError) throw error;
      deps.logger.warn(
        `[hire-agent-handler] invalid pending-hire payloadJson for company ${companyId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const managerLabel = resolvedReportsTo
    ? (() => {
        try {
          return db.core.entity.getAgent(resolvedReportsTo).name;
        } catch {
          return resolvedReportsTo;
        }
      })()
    : "the company board";

  let result: { agentId: string; approvalId: string };
  try {
    result = db.createHireRequest({
      companyId,
      requestedByAgentId: input.requestedByAgentId ?? requesterId,
      name: input.name,
      role: input.role,
      title: input.title,
      department: input.department ?? null,
      reportsTo: resolvedReportsTo,
      connectorId: input.connectorId,
      workspaceId: input.workspaceId ?? null,
      model: input.model ?? null,
      metadataJson: input.metadataJson ?? "{}",
      capabilities: input.capabilities,
      budgetMonthlyUsd: input.budgetMonthlyUsd,
      payloadSummary: `Hire ${input.name} as ${input.role}`,
      impactSummary: input.capabilities || `${input.name} will report to ${managerLabel}.`,
      payloadJson: JSON.stringify({
        name: input.name,
        role: input.role,
        title: input.title,
        requestedByAgentId: input.requestedByAgentId ?? requesterId,
        requestedConfigurationSnapshot: {
          connectorId: input.connectorId,
          workspaceId: input.workspaceId ?? null,
          model: input.model ?? null,
          metadataJson: input.metadataJson ?? "{}",
          capabilities: input.capabilities,
          budgetMonthlyUsd: input.budgetMonthlyUsd,
          reportsTo: resolvedReportsTo,
          department: input.department ?? null,
          title: input.title,
        },
      }),
    });
  } catch (error) {
    throw classifyUnknownError(error, {
      kind: "upstream",
      code: "hire_agent.create.failed",
      message: error instanceof Error ? error.message : "Hire could not be created.",
      context: { companyId, requesterId },
    });
  }

  try {
    db.core.activity.addActivity({
      companyId,
      actor: requesterId,
      action: "agent.hire_requested",
      entityType: "agent",
      entityId: result.agentId,
      detail: input.name,
    });
  } catch (error) {
    throw new UpstreamError({
      code: "hire_agent.activity.failed",
      message: "Failed to record activity for hire request.",
      cause: error,
    });
  }

  let autoApproved = false;
  if (shouldAutoApprove(db, companyId, "hire_agent")) {
    resolveApprovalDecision({
      db,
      handleApprovalResolved: deps.onApprovalResolved,
      companyId,
      approvalId: result.approvalId,
      state: "approved",
      decisionNote: "Auto-approved by company policy",
      detail: `Auto-approved hire: ${input.name}`,
    });
    autoApproved = true;
    deps.logger.info(
      `[hire-agent-handler] Auto-approved hire of ${input.name} via agent tool.`,
    );
  }

  deps.onDomainChanged();

  const summary = autoApproved
    ? `Hired ${input.name} (${input.role}). Approval ${result.approvalId} was auto-approved by company policy; the new agent id is ${result.agentId}.`
    : `Filed hire_agent approval ${result.approvalId} for ${input.name} (${input.role}). Pending agent id is ${result.agentId}; awaiting board decision.`;

  return {
    content: [{ type: "text", text: summary }],
    details: {
      agentId: result.agentId,
      approvalId: result.approvalId,
      autoApproved,
      name: input.name,
      role: input.role,
    },
    isError: false,
  };
}
