/**
 * Pure helpers for crash-recovery logic, extracted for testability.
 *
 * These encode the behavioral contract of the corresponding AppDatabase methods:
 *   - interruptStaleRuns
 *   - retryInterruptedTask
 *   - markInterruptedTaskFailed
 *
 * The helpers take narrowly-typed "statement runner" interfaces so they can be
 * exercised in unit tests without a live SQLite connection.
 */

export interface StaleRunDb {
  /** Update all running runs to 'interrupted' and return number of rows changed. */
  interruptRunningRuns(ts: string): number;
  /** Mark tasks associated with interrupted runs as 'blocked'. */
  blockInterruptedTasks(ts: string): void;
  /** Delete task lease rows whose run is now interrupted. */
  clearInterruptedTaskLeases(): void;
  /** Reset all running agents to idle. */
  resetAgentsToIdle(ts: string): void;
  /** Release all workspace locks. */
  releaseAllWorkspaceLocks(): void;
}

export interface RetryTaskDb {
  /** Set task status to 'todo'. */
  setTaskTodo(ts: string, taskId: string): void;
  /** Reset retry_count and last_failure_at. */
  resetTaskRetryFields(ts: string, taskId: string): void;
}

export interface FailTaskDb {
  /** Set task status to 'cancelled'. */
  setTaskCancelled(ts: string, taskId: string): void;
}

/**
 * Transactionally marks all running runs as interrupted and associated tasks
 * as blocked. Returns the number of interrupted runs.
 */
export function interruptStaleRunsLogic(
  db: StaleRunDb,
  transaction: (fn: () => void) => void,
  nowIso: () => string,
): number {
  let interruptedCount = 0;
  transaction(() => {
    const ts = nowIso();
    interruptedCount = db.interruptRunningRuns(ts);
    if (interruptedCount > 0) {
      db.blockInterruptedTasks(ts);
    }
    db.clearInterruptedTaskLeases();
    db.resetAgentsToIdle(ts);
    db.releaseAllWorkspaceLocks();
  });
  return interruptedCount;
}

/** Resets a task to 'todo' and clears its retry state. */
export function retryInterruptedTaskLogic(
  db: RetryTaskDb,
  taskId: string,
  nowIso: () => string,
): void {
  const ts = nowIso();
  db.setTaskTodo(ts, taskId);
  db.resetTaskRetryFields(ts, taskId);
}

/** Marks a task as 'cancelled'. */
export function markInterruptedTaskFailedLogic(
  db: FailTaskDb,
  taskId: string,
  nowIso: () => string,
): void {
  const ts = nowIso();
  db.setTaskCancelled(ts, taskId);
}
