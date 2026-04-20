/**
 * Main-side handler for the `file_approval` internal tool (C4 part 2/5).
 *
 * Mirrors the control flow of `POST /api/companies/:id/approvals` in
 * `api-server/routes-approvals.ts`: validate → enforce the
 * `approve_ceo_strategy` ordering gate → request approval → auto-
 * approve or notify. Both the tool path and the HTTP path funnel
 * through the same `db.approvalsMod.requestApproval` + `shouldAutoApprove`
 * plumbing, so the board sees identical rows regardless of entry point.
 *
 * No fallbacks: malformed input throws UserInputError, DB failures
 * throw UpstreamError. The worker tool wrapper surfaces the classified
 * message as a pi tool-error so the model can correct its call.
 */

import type { AppDatabase } from "@main/database";
import { approvalInputSchema } from "@shared/contracts";
import { resolveApprovalDecision } from "@main/approval-policy";
import { shouldAutoApprove } from "@main/execution-policy";
import { UserInputError, UpstreamError, classifyUnknownError } from "@main/errors";
import type { InvokeInternalToolRpcResult } from "@main/worker/runtime/internal-tools/internal-tool-rpc";

export interface FileApprovalHandlerDeps {
  db: AppDatabase;
  onApprovalCreated: (approvalId: string, companyId: string, taskId: string | null, approvalType: string, summary: string) => void;
  onApprovalResolved: (approvalId: string, companyId: string, decision: string) => void;
  onDomainChanged: () => void;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

export interface FileApprovalHandlerContext {
  companyId: string;
  agentId: string;
}

export function handleFileApprovalToolCall(
  deps: FileApprovalHandlerDeps,
  ctx: FileApprovalHandlerContext,
  rawArgs: unknown,
): InvokeInternalToolRpcResult {
  const { db } = deps;
  const { companyId, agentId: requesterId } = ctx;

  const argObject = typeof rawArgs === "object" && rawArgs !== null
    ? (rawArgs as Record<string, unknown>)
    : {};

  const parsed = approvalInputSchema.safeParse({
    companyId,
    ...argObject,
    requestedByAgentId: requesterId,
  });
  if (!parsed.success) {
    throw new UserInputError({
      code: "file_approval.input.invalid",
      message: `Invalid file_approval payload: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
      context: { companyId, requesterId },
    });
  }
  const input = parsed.data;

  // Mirror the HTTP route's `approve_ceo_strategy` ordering gate: the
  // strategy approval cannot exist before any hire_agent approvals do,
  // and cannot be re-filed once it exists. The tool path would
  // otherwise re-open the exact loop the HTTP gate was written to
  // close.
  if (input.type === "approve_ceo_strategy") {
    const companyHireApprovals = db.approvalsMod.listCompanyApprovalsByType(companyId, "hire_agent");
    if (companyHireApprovals.length === 0) {
      throw new UserInputError({
        code: "file_approval.strategy.before_hires",
        message:
          "approve_ceo_strategy requires at least one hire_agent approval to exist first. File the intended hires, then the strategy.",
      });
    }
    const existingStrategy = db.approvalsMod
      .listCompanyApprovalsByType(companyId, "approve_ceo_strategy")
      .find((a) => a.state === "pending" || a.state === "approved");
    if (existingStrategy) {
      throw new UserInputError({
        code: "file_approval.strategy.already_filed",
        message: `approve_ceo_strategy already exists for this company (id ${existingStrategy.id}); do not submit another.`,
      });
    }
  }

  let approvalId: string;
  try {
    approvalId = db.approvalsMod.requestApproval({
      companyId,
      type: input.type,
      relatedTaskId: input.relatedTaskId ?? null,
      requestedByAgentId: requesterId,
      relatedAgentId: input.relatedAgentId ?? null,
      payloadSummary: input.payloadSummary,
      impactSummary: input.impactSummary,
      payloadJson: input.payloadJson ?? null,
    });
  } catch (error) {
    throw classifyUnknownError(error, {
      kind: "upstream",
      code: "file_approval.create.failed",
      message: error instanceof Error ? error.message : "Approval could not be created.",
      context: { companyId, requesterId, type: input.type },
    });
  }

  try {
    db.activityMod.addActivity({
      companyId,
      actor: requesterId,
      action: "approval.created",
      entityType: "approval",
      entityId: approvalId,
      detail: input.payloadSummary,
    });
  } catch (error) {
    throw new UpstreamError({
      code: "file_approval.activity.failed",
      message: "Failed to record activity for approval.",
      cause: error,
    });
  }

  deps.onApprovalCreated(
    approvalId,
    companyId,
    input.relatedTaskId ?? null,
    input.type,
    input.payloadSummary ?? "",
  );

  let autoApproved = false;
  if (shouldAutoApprove(db, companyId, input.type)) {
    resolveApprovalDecision({
      db,
      handleApprovalResolved: deps.onApprovalResolved,
      companyId,
      approvalId,
      state: "approved",
      decisionNote: "Auto-approved by company policy",
      detail: "Auto-approved by company policy",
    });
    autoApproved = true;
    deps.logger.info(
      `[file-approval-handler] Auto-approved approval ${approvalId}: ${input.payloadSummary}`,
    );
  }

  deps.onDomainChanged();

  const summary = autoApproved
    ? `Filed ${input.type} approval ${approvalId}. Auto-approved by company policy.`
    : `Filed ${input.type} approval ${approvalId}. Pending board decision.`;

  return {
    content: [{ type: "text", text: summary }],
    details: {
      approvalId,
      autoApproved,
      type: input.type,
    },
    isError: false,
  };
}
