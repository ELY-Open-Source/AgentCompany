import { persistRunEvent } from "../run-event-recorder";
import type { HandlerContext, HandlerDeps, WorkerMessageEvent } from "./handler-context";

export function handleRunStatus(
  event: Extract<WorkerMessageEvent, { type: "run-status" }>,
  deps: HandlerDeps,
  _context: HandlerContext,
): void {
  const { db, logger, emitEvent, onRunStarted } = deps;

  const runState = db.getRunAuthState(event.runId);
  db.markRunStatus(event.runId, event.status, event.message);
  if (runState) {
    persistRunEvent(db, logger, {
      companyId: runState.companyId,
      runId: event.runId,
      agentId: runState.agentId,
      eventType: "run_status",
      level:
        event.status === "failed" || event.status === "timed_out" || event.status === "interrupted"
          ? "error"
          : "info",
      message: event.message,
      payload: { status: event.status },
    });
  }
  if (event.status === "running") {
    // D-02: Workspace lock is claimed authoritatively in main's
    // dispatchRunToWorker before enqueue. Only lease renewal and
    // run-started housekeeping run here.
    try {
      const run = db.getRun(event.runId);
      db.renewTaskLease(run.taskId, run.id);
      onRunStarted?.(run.id, run.taskId, run.agentId, run.companyId);
    } catch {
      // Run not found — skip status handling
    }
  }
  emitEvent(event);
  emitEvent({ type: "run-updated", runId: event.runId, action: "status_changed" });
}
