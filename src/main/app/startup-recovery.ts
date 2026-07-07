import type { DatabaseSync } from "node:sqlite";
import { AuditService } from "../services/audit-service";

const INTERRUPTED_MESSAGE = "Interrupted by application shutdown before completion.";

/**
 * A single app instance executes runs in-process, so any task_run still
 * `running` at boot was interrupted by a previous shutdown and has no
 * executor. The run returns to the queue — interruption is not failure, so
 * the work continues without spending the task's retry budget — and the
 * queue worker claims it within one tick. In-flight provider requests from
 * the dead process cannot be resumed: foreground ones fail, and background
 * ones fail only when they never received the external response id the
 * provider background worker needs to resume them.
 */
export function recoverInterruptedWork(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const audit = new AuditService(db);
  const runs = db.prepare("select id, org_id, task_id from task_runs where state = 'running'")
    .all() as Array<{ id: string; org_id: string; task_id: string }>;
  for (const run of runs) {
    db.prepare("update task_runs set state = 'queued', started_at = null where id = ?").run(run.id);
    audit.record({
      orgId: run.org_id,
      entityType: "task_run",
      entityId: run.id,
      actorType: "system",
      actorId: null,
      action: "requeued",
      payload: { taskId: run.task_id, reason: "interrupted_by_shutdown" },
    });
  }
  db.prepare(`
    update provider_requests
    set state = 'failed', completed_at = ?, error_message = ?
    where state in ('pending', 'streaming')
      and (execution_mode = 'foreground' or external_response_id is null)
  `).run(now, INTERRUPTED_MESSAGE);
}
