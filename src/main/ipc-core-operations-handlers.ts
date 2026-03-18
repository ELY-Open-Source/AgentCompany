import {
  IPC_CHANNELS,
  approvalDecisionSchema,
  approvalInputSchema,
  cancelRunSchema,
  commentInputSchema,
  heartbeatSettingsSchema,
  listCommentsSchema,
  runLogChunkSchema,
  runLogSchema,
  startRunSchema,
  triggerHeartbeatSchema,
} from "@shared/contracts";
import { fail, ok, type RegisterCoreHandlersDependencies } from "./ipc-core-common";

export function registerCoreOperationHandlers({
  registerHandle,
  db,
  ensureCompanyExists,
  publishDomainChanged,
  emitEvent,
  wakeAgentIfPossible,
  handleApprovalResolved,
  dispatchAutomation,
  queueTaskRun,
  getWorkerProcess,
}: Pick<
  RegisterCoreHandlersDependencies,
  | "registerHandle"
  | "db"
  | "ensureCompanyExists"
  | "publishDomainChanged"
  | "emitEvent"
  | "wakeAgentIfPossible"
  | "handleApprovalResolved"
  | "dispatchAutomation"
  | "queueTaskRun"
  | "getWorkerProcess"
>) {
  registerHandle(IPC_CHANNELS.requestApproval, async (_event, payload) => {
    const parsed = approvalInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const invalidTask = parsed.relatedTaskId && !db.belongsToCompany("tasks", parsed.relatedTaskId, parsed.companyId);
    const invalidAgent = parsed.requestedByAgentId && !db.belongsToCompany("agents", parsed.requestedByAgentId, parsed.companyId);
    if (invalidTask || invalidAgent) {
      return fail("INVALID_COMPANY_REFERENCE", "The approval references data outside the current company.");
    }
    const id = db.requestApproval(parsed);
    db.addActivity({
      companyId: parsed.companyId,
      actor: parsed.requestedByAgentId ?? "board",
      action: "approval.created",
      entityType: "approval",
      entityId: id,
      detail: parsed.payloadSummary,
    });
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.decideApproval, async (_event, payload) => {
    const parsed = approvalDecisionSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.belongsToCompany("approvals", parsed.approvalId, parsed.companyId)) {
      return fail("APPROVAL_NOT_FOUND", "Approval not found in the current company.");
    }
    const approval = db.getApprovalRecord(parsed.approvalId);
    if (!approval || approval.companyId !== parsed.companyId) {
      return fail("APPROVAL_NOT_FOUND", "Approval not found in the current company.");
    }
    db.decideApproval(parsed);
    db.addActivity({
      companyId: approval.companyId,
      actor: "board",
      action: `approval.${parsed.state}`,
      entityType: "approval",
      entityId: approval.id,
      detail: parsed.decisionNote,
    });
    handleApprovalResolved(parsed.approvalId, approval.companyId, parsed.state);
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.startTaskRun, async (_event, payload) => {
    const parsed = startRunSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.belongsToCompany("tasks", parsed.taskId, parsed.companyId)) {
      return fail("TASK_NOT_FOUND", "Task not found in the current company.");
    }
    return queueTaskRun(parsed.taskId, "manual", "board");
  });

  registerHandle(IPC_CHANNELS.cancelRun, (_event, payload) => {
    const parsed = cancelRunSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.belongsToCompany("runs", parsed.runId, parsed.companyId)) {
      return fail("RUN_NOT_FOUND", "Run not found in the current company.");
    }
    getWorkerProcess()?.postMessage({ type: "cancel-run", runId: parsed.runId });
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.getRunLog, (_event, payload) => {
    const parsed = runLogSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.belongsToCompany("runs", parsed.runId, parsed.companyId)) {
      return fail("RUN_NOT_FOUND", "Run not found in the current company.");
    }
    return ok(db.readRunLog(parsed.runId));
  });

  registerHandle(IPC_CHANNELS.getRunLogChunk, (_event, payload) => {
    const parsed = runLogChunkSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.belongsToCompany("runs", parsed.runId, parsed.companyId)) {
      return fail("RUN_NOT_FOUND", "Run not found in the current company.");
    }
    return ok(db.readRunLogChunk(parsed.runId, parsed.offset, parsed.limit));
  });

  registerHandle(IPC_CHANNELS.addComment, async (_event, payload) => {
    const parsed = commentInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const comment = db.addComment({
      companyId: parsed.companyId,
      taskId: parsed.taskId,
      authorAgentId: parsed.authorAgentId ?? null,
      authorName: parsed.authorName,
      body: parsed.body,
    });
    db.addActivity({
      companyId: parsed.companyId,
      actor: parsed.authorAgentId ?? "board",
      action: "comment.created",
      entityType: "task",
      entityId: parsed.taskId,
      detail: parsed.body.slice(0, 100),
    });
    emitEvent({ type: "agent-message", taskId: parsed.taskId, comment });
    publishDomainChanged();
    try {
      const task = db.getTask(parsed.taskId);
      if (task.assigneeAgentId) {
        wakeAgentIfPossible(task.assigneeAgentId, task.companyId, "comment");
      }
      dispatchAutomation("comment_posted", {
        companyId: parsed.companyId,
        taskId: parsed.taskId,
        agentId: parsed.authorAgentId ?? undefined,
      });
    } catch {
      // Task may have been deleted between comment creation and wake evaluation.
    }
    return ok(comment.id);
  });

  registerHandle(IPC_CHANNELS.listComments, async (_event, payload) => {
    const parsed = listCommentsSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.belongsToCompany("tasks", parsed.taskId, parsed.companyId)) {
      return fail("TASK_NOT_FOUND", "Task not found in the current company.");
    }
    return ok(db.listComments(parsed.taskId));
  });

  registerHandle(IPC_CHANNELS.setHeartbeat, async (_event, payload) => {
    const parsed = heartbeatSettingsSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.belongsToCompany("agents", parsed.agentId, parsed.companyId)) {
      return fail("AGENT_NOT_FOUND", "Agent not found in the current company.");
    }
    db.setHeartbeat(parsed.agentId, parsed.enabled, parsed.intervalSec);
    db.addActivity({
      companyId: parsed.companyId,
      actor: "board",
      action: parsed.enabled ? "heartbeat.enabled" : "heartbeat.disabled",
      entityType: "agent",
      entityId: parsed.agentId,
      detail: `Interval: ${parsed.intervalSec}s`,
    });
    emitEvent({ type: "heartbeat-status", agentId: parsed.agentId, enabled: parsed.enabled, nextWakeAt: null });
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.triggerHeartbeat, async (_event, payload) => {
    const parsed = triggerHeartbeatSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.belongsToCompany("agents", parsed.agentId, parsed.companyId)) {
      return fail("AGENT_NOT_FOUND", "Agent not found in the current company.");
    }
    const runId = wakeAgentIfPossible(parsed.agentId, parsed.companyId, parsed.trigger);
    if (!runId) {
      return fail("HEARTBEAT_SKIPPED", "Agent cannot be woken right now (check connector status, budget, or active runs).");
    }
    return ok(runId);
  });
}
