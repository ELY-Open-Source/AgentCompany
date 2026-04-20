import log from "electron-log/main.js";
import type { Migration, MigrationDeps } from "./types";
import { tableExists } from "./types";

/**
 * B2 Phase 1 hotfix — relax `task_leases.run_id` FK to `runs(id)`.
 *
 * v50 created `task_leases.run_id TEXT NOT NULL REFERENCES runs(id)`.
 * That FK was a well-intentioned tightening over the legacy
 * `tasks.checkout_run_id` column (which had no FK at all), but it
 * broke the orchestration sequence: `heartbeat.ts` and `task-runner.ts`
 * generate a fresh `runId = randomUUID()` and call `checkoutTask` on
 * the task *before* the corresponding row is inserted into `runs`.
 * With the FK on, `writeCheckoutLease` → `INSERT INTO task_leases`
 * fails with `FOREIGN KEY constraint failed`, the whole CAS rolls
 * back, `checkoutTask` returns false, and the heartbeat loops on
 * `checkout_race_lost` forever — the exact orphan symptom B2 was
 * supposed to *eliminate*.
 *
 * The legacy `tasks.checkout_run_id` was always "dangling allowed"
 * (the run row is saved later by the task-runner), and during B2
 * Phase 1 the lease row is the shadow mirror of that same legacy
 * intent. It must mirror the legacy's loose semantics until Phase 2
 * tightens the whole contract in one coordinated step.
 *
 * Fix: recreate `task_leases` without the `run_id` FK. `task_id`
 * keeps its FK + ON DELETE CASCADE (you cannot lease a task that
 * does not exist) and the UNIQUE(task_id, run_id) pair survives
 * (still meaningful, just no longer FK-checked). Existing rows are
 * preserved verbatim via INSERT SELECT.
 *
 * PRAGMA foreign_keys cannot be toggled inside an open transaction
 * (SQLite restriction), so we follow the pattern used by v40 / v41 /
 * v43 / v44 — but those migrations run their own rebuilds *without*
 * nesting inside the outer transaction boundary. In our case the
 * outer `runMigrations` wrapping in `schema.ts` already opens
 * BEGIN IMMEDIATE, so we use `PRAGMA defer_foreign_keys = ON`
 * instead, which *is* valid inside a transaction and defers all FK
 * checks until COMMIT. Since we are removing an FK rather than
 * relying on one, the defer_foreign_keys toggle simply prevents a
 * spurious check during the INSERT SELECT window.
 */

export function createMigrationsV51V51(deps: MigrationDeps): Migration[] {
  const { db } = deps;
  return [
    {
      version: 51,
      name: "task_leases_drop_run_id_fk",
      fn: () => {
        if (!tableExists(db, "task_leases")) {
          log.info("[migration v51] task_leases table missing; nothing to do");
          return;
        }

        db.exec("PRAGMA defer_foreign_keys = ON");

        db.exec(`
          CREATE TABLE task_leases_new (
            task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
            run_id TEXT NOT NULL,
            acquired_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            checkout_run_id TEXT,
            UNIQUE(task_id, run_id)
          )
        `);

        db.exec(`
          INSERT INTO task_leases_new
            (task_id, run_id, acquired_at, expires_at, checkout_run_id)
          SELECT task_id, run_id, acquired_at, expires_at, checkout_run_id
            FROM task_leases
        `);

        db.exec("DROP INDEX IF EXISTS idx_task_leases_expires_at");
        db.exec("DROP TABLE task_leases");
        db.exec("ALTER TABLE task_leases_new RENAME TO task_leases");
        db.exec(
          "CREATE INDEX IF NOT EXISTS idx_task_leases_expires_at ON task_leases(expires_at)",
        );

        log.info(
          "[migration v51] task_leases recreated without run_id FK; task_id FK + UNIQUE(task_id, run_id) preserved",
        );
      },
    },
  ];
}
