import { z } from "zod";
import log from "electron-log/main.js";
import { approvalInputSchema } from "@shared/contracts";
import { resolveApprovalDecision } from "../approval-policy";
import { shouldAutoApprove } from "../execution-policy";
import { incrementDeprecationCall } from "./deprecation-counter";
import { requireParam, type AgentApiServer } from "./server-core";

// C4-followup #3: RFC 8594 deprecation headers for the legacy
// approve_ceo_strategy HTTP path. Only this approval type is
// deprecated — other types still use this route as first-class.
const LEGACY_APPROVE_CEO_STRATEGY_LABEL =
  "POST /api/companies/:companyId/approvals type=approve_ceo_strategy";
const LEGACY_APPROVE_CEO_STRATEGY_SUNSET = new Date("2026-05-20T00:00:00Z").toUTCString();

const approvalListQuerySchema = z.object({
  requestedByAgentId: z.string().uuid().optional(),
  relatedTaskId: z.string().uuid().optional(),
  status: z.string().optional(),
});

export function registerApprovalRoutes(server: AgentApiServer) {
  const db = server.db;
  const callbacks = server.callbacks;
  const onDomainChanged = server.onDomainChanged;
  const onWakeAgent = server.onWakeAgent;

  /**
   * @deprecated since C4 (2026-04-20) for the `approve_ceo_strategy`
   * flow. CEOs should file that approval via the `file_approval` pi
   * tool (see `src/main/worker/runtime/internal-tools/file-approval-
   * tool.ts`). Other approval types still use this HTTP route. Once
   * every approval type has a tool surface, this route is removed
   * outright; until then, the deprecated warn is scoped to
   * `approve_ceo_strategy` so signal stays clean.
   */
  server.addRoute("POST", "/api/companies/:companyId/approvals", (_req, res, params, token, body) => {
    const companyId = requireParam(params, "companyId");
    if (companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    const parsed = approvalInputSchema.safeParse({
      companyId,
      ...(typeof body === "object" && body ? body : {}),
      requestedByAgentId: token.agentId,
    });
    if (!parsed.success) {
      server.json(res, 400, { error: "Invalid approval payload" });
      return;
    }
    const input = parsed.data;
    if (input.type === "approve_ceo_strategy") {
      res.setHeader("Deprecation", "true");
      res.setHeader("Sunset", LEGACY_APPROVE_CEO_STRATEGY_SUNSET);
      res.setHeader("Link", '</docs/proposals/C4-followup.md>; rel="deprecation"');
      incrementDeprecationCall(LEGACY_APPROVE_CEO_STRATEGY_LABEL);
      log.warn(
        `[deprecated][C4] POST /api/companies/${companyId}/approvals type=approve_ceo_strategy — prefer the file_approval internal tool (caller agent=${token.agentId}).`,
      );
    }
    if (server.companyRefError(res, companyId, [
      { id: input.relatedTaskId, table: "tasks", label: "related task" },
      { id: token.agentId, table: "agents", label: "requesting agent" },
      { id: input.relatedAgentId, table: "agents", label: "related agent" },
    ])) {
      return;
    }

    // Team-building strategy approvals must follow their intended hires.
    // Accepting an approve_ceo_strategy before any hire_agent requests
    // exist was observed to re-enter the empty team-building loop (see
    // comment in ceo-modes/team-building.en.md and §5.2 of 问题.md).
    // Reject the request at the API boundary so the model cannot
    // circumvent the ordering by resubmitting.
    if (input.type === "approve_ceo_strategy") {
      const companyHireApprovals = db.approvalsMod.listCompanyApprovalsByType(companyId, "hire_agent");
      if (companyHireApprovals.length === 0) {
        server.json(res, 409, {
          error: "approve_ceo_strategy requires at least one hire_agent approval to exist first. Submit the intended hires, then file the strategy.",
          code: "STRATEGY_BEFORE_HIRES",
        });
        return;
      }
      const existingStrategy = db.approvalsMod.listCompanyApprovalsByType(companyId, "approve_ceo_strategy")
        .find((a) => a.state === "pending" || a.state === "approved");
      if (existingStrategy) {
        server.json(res, 409, {
          error: "approve_ceo_strategy already exists for this company; do not submit another.",
          code: "STRATEGY_ALREADY_FILED",
          existingApprovalId: existingStrategy.id,
        });
        return;
      }
    }

    let id: string;
    try {
      id = db.approvalsMod.requestApproval({
        companyId,
        type: input.type,
        relatedTaskId: input.relatedTaskId ?? null,
        requestedByAgentId: token.agentId,
        relatedAgentId: input.relatedAgentId ?? null,
        payloadSummary: input.payloadSummary,
        impactSummary: input.impactSummary,
        payloadJson: input.payloadJson ?? null,
      });
    } catch (error) {
      server.json(res, 422, { error: error instanceof Error ? error.message : "Approval could not be created" });
      return;
    }

    db.activityMod.addActivity({
      companyId,
      actor: token.agentId,
      action: "approval.created",
      entityType: "approval",
      entityId: id,
      detail: input.payloadSummary,
    });

    // Notify thread integration about the new approval
    callbacks.onApprovalCreated(id, companyId, input.relatedTaskId ?? null, input.type, input.payloadSummary ?? "");

    if (shouldAutoApprove(db, companyId, input.type)) {
      resolveApprovalDecision({
        db,
        handleApprovalResolved: callbacks.onApprovalResolved,
        companyId,
        approvalId: id,
        state: "approved",
        decisionNote: "Auto-approved by company policy",
        detail: "Auto-approved by company policy",
      });
      log.info(`[auto-approve] Auto-approved approval ${id}: ${input.payloadSummary}`);
    } else {
      callbacks.notify({
        title: "Approval Required",
        body: input.payloadSummary ?? `${input.type} approval pending`,
        urgency: "critical",
        navigation: { section: "approvals", entityId: id },
        batchKey: "pending_approval",
      });
    }

    onDomainChanged();
    server.json(res, 201, { id });
  });

  server.addRoute("GET", "/api/companies/:companyId/approvals", (req, res, params, token) => {
    const companyId = requireParam(params, "companyId");
    if (companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${server.port}`);
    const parsedQuery = approvalListQuerySchema.safeParse({
      requestedByAgentId: url.searchParams.get("requestedByAgentId") ?? undefined,
      relatedTaskId: url.searchParams.get("relatedTaskId") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
    });
    if (!parsedQuery.success) {
      server.json(res, 400, { error: "Invalid approval query" });
      return;
    }
    const statuses = parsedQuery.data.status?.split(",").filter(Boolean) ?? null;
    const approvals = db.approvalsMod.listApprovalsForApi(companyId, {
      requestedByAgentId: parsedQuery.data.requestedByAgentId,
      relatedTaskId: parsedQuery.data.relatedTaskId,
      statuses,
    });
    server.json(res, 200, approvals);
  });

  server.addRoute("GET", "/api/approvals/:approvalId", (_req, res, params, token) => {
    const approval = db.approvalsMod.findApprovalById(requireParam(params, "approvalId"));
    if (!approval || approval.companyId !== token.companyId) {
      server.json(res, 404, { error: "Approval not found" });
      return;
    }
    server.json(res, 200, approval);
  });

  server.addRoute("PATCH", "/api/approvals/:approvalId", (_req, res) => {
    server.json(res, 403, { error: "Approvals must be decided from the desktop board, not from an agent run token" });
  });

  server.addRoute("GET", "/api/approvals/:approvalId/comments", (_req, res, params, token) => {
    const approvalId = requireParam(params, "approvalId");
    const approval = db.approvalsMod.findApprovalById(approvalId);
    if (!approval) { server.json(res, 404, { error: "Approval not found" }); return; }
    if (approval.companyId !== token.companyId) { server.json(res, 403, { error: "Company mismatch" }); return; }
    const comments = db.approvalsMod.listApprovalComments(approvalId, approval.companyId);
    server.json(res, 200, comments);
  });

  server.addRoute("POST", "/api/approvals/:approvalId/comments", (_req, res, params, token, body) => {
    const approval = db.approvalsMod.findApprovalById(requireParam(params, "approvalId"));
    if (!approval) { server.json(res, 404, { error: "Approval not found" }); return; }
    if (approval.companyId !== token.companyId) { server.json(res, 403, { error: "Company mismatch" }); return; }
    const data = body as Record<string, unknown>;
    const commentBody = typeof data.body === "string" ? data.body.trim() : "";
    if (!commentBody) { server.json(res, 400, { error: "Comment body is required" }); return; }
    const commentId = db.approvalsMod.addApprovalComment({
      companyId: approval.companyId,
      approvalId: approval.id,
      authorAgentId: token.agentId ?? null,
      body: commentBody,
    });
    // Wake mentioned agents in comment
    const mentionedIds = db.agents.findMentionedAgentIds(approval.companyId, commentBody);
    for (const mentionedId of mentionedIds) {
      if (mentionedId !== token.agentId) {
        onWakeAgent(mentionedId, approval.companyId, "approval_comment_mentioned");
      }
    }
    onDomainChanged();
    server.json(res, 201, { id: commentId });
  });

  server.addRoute("POST", "/api/approvals/:approvalId/resubmit", (_req, res, params, token) => {
    const approval = db.approvalsMod.findApprovalById(requireParam(params, "approvalId"));
    if (!approval) { server.json(res, 404, { error: "Approval not found" }); return; }
    if (approval.companyId !== token.companyId) { server.json(res, 403, { error: "Company mismatch" }); return; }
    if (approval.state !== "revision_requested") {
      server.json(res, 422, { error: "Only revision_requested approvals can be resubmitted" });
      return;
    }
    if (token.agentId !== approval.requestedByAgentId) {
      server.json(res, 403, { error: "Only the requesting agent can resubmit this approval" });
      return;
    }
    db.approvalsMod.resubmitApproval(approval.id, approval.companyId);
    onDomainChanged();
    server.json(res, 200, { resubmitted: true });
  });

  server.addRoute("GET", "/api/approvals/:approvalId/tasks", (_req, res, params, token) => {
    const approvalId = requireParam(params, "approvalId");
    const approval = db.approvalsMod.findApprovalById(approvalId);
    if (!approval) { server.json(res, 404, { error: "Approval not found" }); return; }
    if (approval.companyId !== token.companyId) { server.json(res, 403, { error: "Company mismatch" }); return; }
    const taskIds = db.approvalsMod.listTasksForApproval(approvalId);
    server.json(res, 200, taskIds);
  });

  server.addRoute("POST", "/api/approvals/:approvalId/tasks", (_req, res, params, token, body) => {
    const approvalId = requireParam(params, "approvalId");
    const approval = db.approvalsMod.findApprovalById(approvalId);
    if (!approval) { server.json(res, 404, { error: "Approval not found" }); return; }
    if (approval.companyId !== token.companyId) { server.json(res, 403, { error: "Company mismatch" }); return; }
    const data = body as Record<string, unknown>;
    const taskIds = Array.isArray(data.taskIds) ? data.taskIds.filter((id): id is string => typeof id === "string") : [];
    if (taskIds.length === 0) { server.json(res, 400, { error: "taskIds array is required" }); return; }
    for (const taskId of taskIds) {
      if (!db.settings.belongsToCompany("tasks", taskId, token.companyId)) {
        server.json(res, 400, { error: `Task ${taskId} does not belong to this company` }); return;
      }
    }
    db.approvalsMod.linkManyTasksToApproval(approvalId, taskIds, token.companyId, token.agentId ?? null);
    onDomainChanged();
    server.json(res, 200, { linked: taskIds.length });
  });
}
