import type { DatabaseSync } from "node:sqlite";
import { AuditService } from "./audit-service";
import { closeChatWakeTask } from "./chat-wake-close";

/** Cancels a run that has not started: not a failure, no retry budget spent; a chat reply it carried closes. */
export function cancelQueuedRun(db: DatabaseSync, orgId: string, runId: string): void {
  const result = db.prepare(`
    update task_runs set state = 'stopped', completed_at = ?, error_message = 'Cancelled before it started.'
    where id = ? and org_id = ? and state = 'queued'
  `).run(new Date().toISOString(), runId, orgId);
  if (result.changes === 0) throw new Error("That run is no longer queued.");
  console.info(`[task-run] run ${runId} cancelled before it started`);
  closeChatWakeTask(db, orgId, runId);
  new AuditService(db).record({ orgId, entityType: "task_run", entityId: runId, actorType: "employee", actorId: null, action: "cancelled", payload: {} });
}
