import type { DatabaseSync } from "node:sqlite";
import { nowIso } from "./helpers";

/**
 * B2 Phase 1 step 2/5 — pure helpers for the new phase + lease shadow.
 *
 * These helpers expose the shape the state-machine refactor will
 * eventually take — a single CAS function for phase transitions, and
 * a lease table with explicit acquire/release/renew — without yet
 * swapping the production call sites over. Step 3/5 wires the existing
 * writes (checkoutTask, finishRun, interruptStaleRuns, recoverStaleLocks)
 * to call these helpers in a dual-write arrangement alongside the
 * legacy columns; until then the helpers are callable but unused.
 *
 * The enum here matches the v50 migration CHECK constraint exactly.
 * Any drift between this module and v50-v50.ts is a bug — the TypeScript
 * `TaskPhase` union is the compile-time mirror of the SQL constraint.
 */

/** Canonical phase enum matching the v50 CHECK constraint. */
export type TaskPhase =
  | "todo"
  | "backlog"
  | "in_progress"
  | "blocked"
  | "completed"
  | "cancelled";

export interface TaskLeaseRow {
  taskId: string;
  runId: string;
  acquiredAt: string;
  expiresAt: string;
  checkoutRunId: string | null;
}

export interface AcquireTaskLeaseInput {
  taskId: string;
  runId: string;
  /** Lease time-to-live in milliseconds. Mapped onto `expires_at`. */
  ttlMs: number;
  /** Optional `checkout_run_id` to mirror onto the lease row. */
  checkoutRunId?: string | null;
}

export interface TasksPhaseMethods {
  /**
   * Compare-and-swap phase transition. Returns true when the row was
   * updated (current phase matched `from`), false otherwise. The caller
   * is responsible for wrapping lease writes in the same transaction
   * when the transition is coupled to a lease acquire/release.
   */
  advanceTaskPhase(taskId: string, from: TaskPhase, to: TaskPhase): boolean;

  /**
   * Insert or replace the lease row for `taskId`. When an unexpired
   * lease for a *different* run already exists, returns null and writes
   * nothing. Callers treat null as "another run owns this task; do not
   * proceed".
   *
   * The staleness check is a clock comparison against `now()` — a lease
   * whose `expires_at` is in the past is considered releasable, so a
   * subsequent acquire from a new run replaces it. This mirrors the
   * existing `recoverStaleLocks` behavior but scoped to the new
   * lease table.
   */
  acquireTaskLease(input: AcquireTaskLeaseInput): TaskLeaseRow | null;

  /**
   * Release the lease for `taskId` when the current row belongs to
   * `runId`. Returns true when a row was deleted.
   */
  releaseTaskLease(taskId: string, runId: string): boolean;

  /**
   * Read the current lease row (if any) for `taskId`.
   */
  getTaskLease(taskId: string): TaskLeaseRow | null;
}

export function buildTasksPhaseMethods(
  getDb: () => DatabaseSync,
): TasksPhaseMethods {
  function readLease(taskId: string): TaskLeaseRow | null {
    const row = getDb()
      .prepare(
        `SELECT task_id AS taskId,
                run_id AS runId,
                acquired_at AS acquiredAt,
                expires_at AS expiresAt,
                checkout_run_id AS checkoutRunId
           FROM task_leases
          WHERE task_id = ?`,
      )
      .get(taskId) as TaskLeaseRow | undefined;
    return row ?? null;
  }

  return {
    advanceTaskPhase(taskId, from, to) {
      const ts = nowIso();
      const result = getDb()
        .prepare(
          `UPDATE tasks
              SET phase = ?, updated_at = ?
            WHERE id = ? AND phase = ?`,
        )
        .run(to, ts, taskId, from);
      return result.changes > 0;
    },

    acquireTaskLease({ taskId, runId, ttlMs, checkoutRunId }) {
      if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
        throw new Error(
          `acquireTaskLease: ttlMs must be a positive finite number, got ${ttlMs}`,
        );
      }
      const nowMs = Date.now();
      const acquiredAt = new Date(nowMs).toISOString();
      const expiresAt = new Date(nowMs + ttlMs).toISOString();

      const existing = readLease(taskId);
      if (existing) {
        const existingExpiresMs = Date.parse(existing.expiresAt);
        const stillLive =
          Number.isFinite(existingExpiresMs) && existingExpiresMs > nowMs;
        if (stillLive && existing.runId !== runId) {
          return null;
        }
        // Same run refreshing its own lease, or a stale lease to be
        // replaced. Either way we rewrite the row with the new window.
        getDb()
          .prepare(
            `UPDATE task_leases
                SET run_id = ?, acquired_at = ?, expires_at = ?, checkout_run_id = ?
              WHERE task_id = ?`,
          )
          .run(runId, acquiredAt, expiresAt, checkoutRunId ?? null, taskId);
        return readLease(taskId);
      }

      getDb()
        .prepare(
          `INSERT INTO task_leases
             (task_id, run_id, acquired_at, expires_at, checkout_run_id)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(taskId, runId, acquiredAt, expiresAt, checkoutRunId ?? null);
      return readLease(taskId);
    },

    releaseTaskLease(taskId, runId) {
      const result = getDb()
        .prepare(`DELETE FROM task_leases WHERE task_id = ? AND run_id = ?`)
        .run(taskId, runId);
      return result.changes > 0;
    },

    getTaskLease(taskId) {
      return readLease(taskId);
    },
  };
}
