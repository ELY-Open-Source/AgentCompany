import type { DatabaseSync } from "node:sqlite";

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}

function assertRunExists(db: DatabaseSync, runId: string): void {
  const row = db
    .prepare("SELECT 1 AS present FROM runs WHERE id = ?")
    .get(runId) as { present: number } | undefined;
  if (!row) {
    throw new Error(`Run not found for task checkout: ${runId}`);
  }
}

export function checkoutTaskInTransaction(
  db: DatabaseSync,
  taskId: string,
  runId: string,
): boolean {
  assertRunExists(db, runId);
  const nowMs = Date.now();
  const ts = isoFromMs(nowMs);
  const result = db
    .prepare(
      `UPDATE tasks
       SET checkout_run_id = ?,
           active_run_id = ?,
           execution_locked_at = ?,
           status = 'in_progress',
           updated_at = ?
     WHERE id = ?
       AND checkout_run_id IS NULL
       AND status IN ('todo', 'backlog')`,
    )
    .run(runId, runId, ts, ts, taskId);

  if (result.changes === 0) {
    return false;
  }

  return true;
}
