import type { DatabaseSync } from "node:sqlite";
import { AuditService } from "../services/audit-service";

const INTERRUPTED_MESSAGE = "Interrupted by application shutdown before completion.";

/**
 * A single app instance executes runs in-process, so any task_run still
 * `running` at boot was interrupted by a previous shutdown and has no
 * executor. Marking it failed — together with its in-flight foreground
 * provider requests — returns the task to the heartbeat, which enqueues a
 * fresh run within one tick. Background provider requests are left alone:
 * the provider background worker resumes those from their external id.
 */
export function recoverInterruptedWork(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const audit = new AuditService(db);
  const runs = db.prepare("select id, org_id, task_id from task_runs where state = 'running'")
    .all() as Array<{ id: string; org_id: string; task_id: string }>;
  for (const run of runs) {
    db.prepare("update task_runs set state = 'failed', completed_at = ?, error_message = ? where id = ?")
      .run(now, INTERRUPTED_MESSAGE, run.id);
    audit.record({
      orgId: run.org_id,
      entityType: "task_run",
      entityId: run.id,
      actorType: "system",
      actorId: null,
      action: "failed",
      payload: { taskId: run.task_id, reason: "interrupted_by_shutdown" },
    });
  }
  db.prepare(`
    update provider_requests
    set state = 'failed', completed_at = ?, error_message = ?
    where execution_mode = 'foreground' and state in ('pending', 'streaming')
  `).run(now, INTERRUPTED_MESSAGE);
}
