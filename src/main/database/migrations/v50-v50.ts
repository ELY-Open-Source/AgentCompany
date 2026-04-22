import log from "electron-log/main.js";
import { STALE_LOCK_TIMEOUT_MS } from "../../constants";
import type { Migration, MigrationDeps } from "./types";
import { columnExists, nowIso, tableExists } from "./types";

/**
 * B2 Phase 1 step 1/5 — dual-write substrate.
 *
 * This migration installs the new `tasks.phase` column and the new
 * `task_leases` table **without** switching the runtime over. Existing
 * reads and writes continue against `tasks.status` /
 * `tasks.checkout_run_id` / `tasks.execution_locked_at`; the new shapes
 * ship as a shadow surface that later phases (2/5 onward) populate in
 * parallel so we can verify the state machine before flipping reads.
 *
 * The migration is transactional by virtue of `runMigrations` wrapping
 * every `migration.fn` in `BEGIN IMMEDIATE`. Backfill and invariant
 * assertion therefore commit atomically with the schema change: a
 * failure at any step rolls the entire migration back, and the
 * pre-migration automatic snapshot (taken by `runMigrations` before
 * applying pending migrations) stays available as the last-resort
 * recovery point.
 *
 * Phase enum follows the user-supplied canonical set:
 *   'todo' | 'backlog' | 'in_progress' | 'blocked' | 'completed' | 'cancelled'
 *
 * The backfill maps the six legacy `tasks.status` values 1:1 — with
 * `done → completed` and `in_review → in_progress` (a reviewable task
 * is still mid-flight, and the review stage is orthogonal to phase).
 * Any post-backfill row with `phase IS NULL` represents data the map
 * did not anticipate; the assertion at the end of the migration throws
 * rather than silently leaving the shadow column inconsistent.
 *
 * `task_leases` mirrors the lease component of the current lock
 * metadata (`checkout_run_id` + `execution_locked_at`). Only rows whose
 * task currently owns an `active_run_id` OR has a live `checkout_run_id`
 * get a seeded lease; `expires_at` uses the existing lease timestamp
 * plus the runtime stale-lock timeout when present, otherwise a 15-minute
 * default from `now()` so the stale-lock sweep still applies to seeded
 * rows. The seed is best-effort: missing runs (referenced by a stale
 * `checkout_run_id` but deleted from `runs`) are skipped rather than
 * throwing, because the FK would reject them and the existing lock was
 * already orphaned pre-migration.
 */

export function createMigrationsV50V50(deps: MigrationDeps): Migration[] {
  const { db } = deps;
  return [
    {
      version: 50,
      name: "tasks_phase_and_leases_dual_write",
      fn: () => {
        if (!tableExists(db, "tasks")) {
          log.info("[migration v50] tasks table missing; nothing to do");
          return;
        }

        // ── 1. Add `tasks.phase` (nullable at add time so the ALTER
        //    succeeds on an existing non-empty table). The CHECK
        //    constraint enforces the enum for new writes; legacy rows
        //    populate via the backfill two steps down.
        if (!columnExists(db, "tasks", "phase")) {
          db.exec(
            `ALTER TABLE tasks ADD COLUMN phase TEXT CHECK (
               phase IS NULL OR phase IN (
                 'todo', 'backlog', 'in_progress', 'blocked', 'completed', 'cancelled'
               )
             )`,
          );
          log.info("[migration v50] tasks.phase column added");
        } else {
          log.info("[migration v50] tasks.phase already present; reusing");
        }

        // ── 2. Create `task_leases`. The UNIQUE(task_id, run_id) pair
        //    matches the M7 design — a task can hold at most one active
        //    lease (PRIMARY KEY task_id), and that lease cannot belong
        //    to two different runs simultaneously.
        db.exec(
          `CREATE TABLE IF NOT EXISTS task_leases (
             task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
             run_id TEXT NOT NULL REFERENCES runs(id),
             acquired_at TEXT NOT NULL,
             expires_at TEXT NOT NULL,
             checkout_run_id TEXT,
             UNIQUE(task_id, run_id)
           )`,
        );
        db.exec(
          `CREATE INDEX IF NOT EXISTS idx_task_leases_expires_at ON task_leases(expires_at)`,
        );
        log.info("[migration v50] task_leases table ensured");

        // ── 3. Backfill `phase` from the legacy `status` enum.
        //    Mapping:
        //      backlog       → backlog
        //      todo          → todo
        //      in_progress   → in_progress
        //      blocked       → blocked
        //      done          → completed
        //      cancelled     → cancelled
        //      in_review     → in_progress   (reviewable task is still mid-flight)
        db.prepare(
          `UPDATE tasks
              SET phase = CASE status
                WHEN 'backlog' THEN 'backlog'
                WHEN 'todo' THEN 'todo'
                WHEN 'in_progress' THEN 'in_progress'
                WHEN 'blocked' THEN 'blocked'
                WHEN 'done' THEN 'completed'
                WHEN 'cancelled' THEN 'cancelled'
                WHEN 'in_review' THEN 'in_progress'
              END
            WHERE phase IS NULL`,
        ).run();
        log.info("[migration v50] phase backfilled from status");

        // ── 3b. Triggers that maintain the phase/status invariant for
        //    writes that still go through the legacy columns. Step 2/5
        //    introduces an explicit `advanceTaskPhase` helper and step
        //    3/5 wires it into the production call sites, but until
        //    then any `INSERT INTO tasks` or `UPDATE tasks SET status
        //    = …` that bypasses the helper must still yield a row with
        //    a consistent `phase` column — otherwise dual-read
        //    observability in step 4/5 would surface false drift the
        //    moment any task row is created.
        //
        //    The triggers are deliberately one-directional (status →
        //    phase). `advanceTaskPhase` writes phase directly; the
        //    legacy-column writers that coexist during dual-write
        //    continue to set `status` and now have their shadow phase
        //    kept in sync automatically. Once step 3/5 lands and every
        //    call site dual-writes both columns explicitly, these
        //    triggers become a belt-and-braces backstop rather than
        //    the primary invariant.
        db.exec(
          `DROP TRIGGER IF EXISTS trg_tasks_phase_from_status_insert;
           DROP TRIGGER IF EXISTS trg_tasks_phase_from_status_update;`,
        );
        db.exec(
          `CREATE TRIGGER trg_tasks_phase_from_status_insert
             AFTER INSERT ON tasks
             WHEN NEW.phase IS NULL AND NEW.status IS NOT NULL
             BEGIN
               UPDATE tasks SET phase = CASE NEW.status
                 WHEN 'backlog' THEN 'backlog'
                 WHEN 'todo' THEN 'todo'
                 WHEN 'in_progress' THEN 'in_progress'
                 WHEN 'blocked' THEN 'blocked'
                 WHEN 'done' THEN 'completed'
                 WHEN 'cancelled' THEN 'cancelled'
                 WHEN 'in_review' THEN 'in_progress'
               END
               WHERE id = NEW.id;
             END;`,
        );
        db.exec(
          `CREATE TRIGGER trg_tasks_phase_from_status_update
             AFTER UPDATE OF status ON tasks
             WHEN NEW.status IS NOT OLD.status
             BEGIN
               UPDATE tasks SET phase = CASE NEW.status
                 WHEN 'backlog' THEN 'backlog'
                 WHEN 'todo' THEN 'todo'
                 WHEN 'in_progress' THEN 'in_progress'
                 WHEN 'blocked' THEN 'blocked'
                 WHEN 'done' THEN 'completed'
                 WHEN 'cancelled' THEN 'cancelled'
                 WHEN 'in_review' THEN 'in_progress'
               END
               WHERE id = NEW.id;
             END;`,
        );
        log.info("[migration v50] status → phase mirroring triggers installed");

        // ── 4. Seed `task_leases` from the current lock columns.
        //    A task currently holds a runtime lease when `active_run_id`
        //    is set (run is live) or when `checkout_run_id` is set
        //    (run is acquiring). Both map to the same lease row.
        //
        //    `expires_at` uses `execution_locked_at + STALE_LOCK_TIMEOUT_MS`
        //    when present; otherwise it falls back to `now() + 15 minutes`
        //    so the stale-lock sweep keeps working on seeded rows.
        //
        //    The seed cannot attribute to a run that no longer exists
        //    (FK violation on `run_id`). Such rows are skipped — they
        //    are already orphaned state in the legacy columns, and the
        //    migration is not the right place to clean them up. A
        //    follow-up observability pass can surface them.
        const nowMs = Date.now();
        const ts = nowIso();
        const seedRows = db.prepare(
          `SELECT t.id AS taskId,
                  COALESCE(t.active_run_id, t.checkout_run_id) AS runId,
                  t.active_run_id AS activeRunId,
                  t.checkout_run_id AS checkoutRunId,
                  t.execution_locked_at AS executionLockedAt
             FROM tasks t
            WHERE (t.active_run_id IS NOT NULL OR t.checkout_run_id IS NOT NULL)`,
        ).all() as Array<{
          taskId: string;
          runId: string | null;
          activeRunId: string | null;
          checkoutRunId: string | null;
          executionLockedAt: string | null;
        }>;

        const runExistsStmt = db.prepare(`SELECT 1 AS present FROM runs WHERE id = ?`);
        const insertLeaseStmt = db.prepare(
          `INSERT OR IGNORE INTO task_leases
             (task_id, run_id, acquired_at, expires_at, checkout_run_id)
           VALUES (?, ?, ?, ?, ?)`,
        );

        let seeded = 0;
        let skipped = 0;
        for (const row of seedRows) {
          const runId = row.runId;
          if (!runId) continue;
          const runExists = runExistsStmt.get(runId) as { present: number } | undefined;
          if (!runExists) {
            skipped += 1;
            continue;
          }
          const acquiredAt = row.executionLockedAt ?? ts;
          const lockedAtMs = row.executionLockedAt
            ? Date.parse(row.executionLockedAt)
            : NaN;
          const expiresBaseMs = Number.isFinite(lockedAtMs) ? lockedAtMs : nowMs;
          const expiresAt = new Date(expiresBaseMs + STALE_LOCK_TIMEOUT_MS).toISOString();
          insertLeaseStmt.run(row.taskId, runId, acquiredAt, expiresAt, row.checkoutRunId ?? null);
          seeded += 1;
        }
        log.info(
          `[migration v50] task_leases seed complete: ${seeded} seeded, ${skipped} skipped (run missing)`,
        );

        // ── 5. Invariant assertion: every task row must now carry a
        //    phase value. If the backfill missed a status we do not
        //    know about, fail the migration so the problem is visible
        //    at upgrade time rather than days later when a checkoutTask
        //    query silently excludes the row.
        const missingRow = db.prepare(
          `SELECT COUNT(*) AS count FROM tasks WHERE phase IS NULL`,
        ).get() as { count: number } | undefined;
        const missingCount = missingRow?.count ?? 0;
        if (missingCount > 0) {
          const sample = db.prepare(
            `SELECT id, status FROM tasks WHERE phase IS NULL LIMIT 5`,
          ).all() as Array<{ id: string; status: string }>;
          const sampleText = sample
            .map((row) => `${row.id}=${row.status}`)
            .join(", ");
          throw new Error(
            `[migration v50] phase backfill left ${missingCount} rows NULL — unknown status values: ${sampleText}`,
          );
        }
        log.info("[migration v50] invariant check passed: every task has a phase");
      },
    },
  ];
}
