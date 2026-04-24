import type { DatabaseSync } from "node:sqlite";
import { STALE_LOCK_TIMEOUT_MS } from "../constants";

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}

function loadRunForCheckout(
  db: DatabaseSync,
  taskId: string,
  runId: string,
): { companyId: string; agentId: string; taskId: string | null } {
  const row = db
    .prepare("SELECT company_id as companyId, agent_id as agentId, task_id as taskId FROM runs WHERE id = ?")
    .get(runId) as { companyId: string; agentId: string; taskId: string | null } | undefined;
  if (!row) {
    throw new Error(`Run not found for task checkout: ${runId}`);
  }
  if (row.taskId !== null && row.taskId !== taskId) {
    throw new Error(`Run ${runId} is bound to task ${row.taskId}, not ${taskId}.`);
  }
  return row;
}

export function checkoutTaskInTransaction(
  db: DatabaseSync,
  taskId: string,
  runId: string,
): boolean {
  const run = loadRunForCheckout(db, taskId, runId);
  const nowMs = Date.now();
  const ts = isoFromMs(nowMs);
  const result = db
    .prepare(
      `UPDATE tasks
       SET status = 'in_progress',
           started_at = coalesce(started_at, ?),
           updated_at = ?
     WHERE id = ?
       AND company_id = ?
       AND status IN ('todo', 'backlog')
       AND NOT EXISTS (
         SELECT 1 FROM task_leases
         WHERE task_leases.task_id = tasks.id
       )`,
    )
    .run(ts, ts, taskId, run.companyId);

  if (result.changes === 0) {
    return false;
  }

  if (run.taskId === null) {
    db.prepare("update runs set task_id = ?, updated_at = ? where id = ? and task_id is null").run(taskId, ts, runId);
  }

  db
    .prepare(
      `insert into task_leases (
        task_id, company_id, run_id, agent_id, acquired_at, renewed_at, expires_at, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      taskId,
      run.companyId,
      runId,
      run.agentId,
      ts,
      ts,
      isoFromMs(nowMs + STALE_LOCK_TIMEOUT_MS),
      ts,
      ts,
    );

  return true;
}
