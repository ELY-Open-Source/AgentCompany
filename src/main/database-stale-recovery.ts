import type { DatabaseSync } from "node:sqlite";
import { STALE_LOCK_TIMEOUT_MS } from "./database-base";

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Stale-state recovery helpers extracted from `database-base.ts` to keep that
 * file under the 400-line cap. Both helpers are called by `AppDatabase.init`
 * (interruptStaleRuns) and the orchestration recovery loop (recoverStaleLocks).
 */

interface InterruptDeps {
  db: DatabaseSync;
  transaction: <T>(op: () => T) => T;
  releaseAllWorkspaceLocks: () => void;
}

export function interruptStaleRunsImpl(deps: InterruptDeps): number {
  const ts = nowIso();
  let interruptedCount = 0;
  deps.transaction(() => {
    const result = deps.db
      .prepare(
        "update runs set status = 'interrupted', error_message = 'AgentCompany restarted before the run could report completion.', finished_at = ?, updated_at = ? where status = 'running'",
      )
      .run(ts, ts);
    interruptedCount = Number(result.changes);
    if (interruptedCount > 0) {
      deps.db
        .prepare(
          "update tasks set status = 'blocked', updated_at = ? where id in (select task_id from runs where status = 'interrupted' and finished_at = ?) and status in ('in_progress', 'todo')",
        )
        .run(ts, ts);
    }
    deps.db
      .prepare(
        "update tasks set active_run_id = null where active_run_id in (select id from runs where status = 'interrupted')",
      )
      .run();
    deps.db.prepare("update agents set status = 'idle', updated_at = ? where status = 'running'").run(ts);
    deps.releaseAllWorkspaceLocks();
  });
  return interruptedCount;
}

interface RecoverDeps {
  db: DatabaseSync;
  readAll: <T>(sql: string, ...params: import("node:sqlite").SQLInputValue[]) => T[];
}

export function recoverStaleLocksImpl(
  deps: RecoverDeps,
): Array<{ taskId: string; companyId: string; title: string }> {
  const cutoff = new Date(Date.now() - STALE_LOCK_TIMEOUT_MS).toISOString();
  const stale = deps.readAll<{ id: string; companyId: string; title: string }>(
    "SELECT id, company_id AS companyId, title FROM tasks WHERE execution_locked_at IS NOT NULL AND execution_locked_at < ? AND status = 'in_progress' AND checkout_run_id NOT IN (SELECT id FROM runs WHERE status = 'running')",
    cutoff,
  );
  const ts = nowIso();
  for (const task of stale) {
    deps.db
      .prepare(
        "UPDATE tasks SET checkout_run_id = NULL, execution_locked_at = NULL, status = 'todo', updated_at = ? WHERE id = ?",
      )
      .run(ts, task.id);
  }
  return stale.map((t) => ({ taskId: t.id, companyId: t.companyId, title: t.title }));
}
