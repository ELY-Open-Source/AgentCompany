import log from "electron-log/main.js";
import type { Migration, MigrationDeps } from "./types";
import { nowIso, tableExists } from "./types";

export function createMigrationsV53V53(deps: MigrationDeps): Migration[] {
  const { db } = deps;
  return [
    {
      version: 53,
      name: "task_leases_restore_run_fk",
      fn: () => {
        if (!tableExists(db, "task_leases")) {
          log.info("[migration v53] task_leases table missing; nothing to do");
          return;
        }

        const danglingLeases = db.prepare(
          `SELECT l.task_id AS taskId, l.run_id AS runId
             FROM task_leases l
             LEFT JOIN runs r ON r.id = l.run_id
            WHERE r.id IS NULL`,
        ).all() as Array<{ taskId: string; runId: string }>;

        if (danglingLeases.length > 0) {
          const ts = nowIso();
          const repairTask = db.prepare(
            `UPDATE tasks
                SET active_run_id = CASE WHEN active_run_id = ? THEN NULL ELSE active_run_id END,
                    checkout_run_id = CASE WHEN checkout_run_id = ? THEN NULL ELSE checkout_run_id END,
                    execution_locked_at = CASE
                      WHEN active_run_id = ? OR checkout_run_id = ? THEN NULL
                      ELSE execution_locked_at
                    END,
                    updated_at = ?
              WHERE id = ?`,
          );
          for (const lease of danglingLeases) {
            repairTask.run(lease.runId, lease.runId, lease.runId, lease.runId, ts, lease.taskId);
          }
          db.prepare(
            `DELETE FROM task_leases
              WHERE run_id NOT IN (SELECT id FROM runs)`,
          ).run();
          log.warn(
            `[migration v53] removed ${danglingLeases.length} dangling task lease(s) before restoring run_id FK`,
          );
        }

        db.exec("PRAGMA defer_foreign_keys = ON");
        db.exec(`
          CREATE TABLE task_leases_v53 (
            task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
            run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            acquired_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            checkout_run_id TEXT,
            UNIQUE(task_id, run_id)
          )
        `);
        db.exec(`
          INSERT INTO task_leases_v53
            (task_id, run_id, acquired_at, expires_at, checkout_run_id)
          SELECT task_id, run_id, acquired_at, expires_at, checkout_run_id
            FROM task_leases
        `);
        db.exec("DROP INDEX IF EXISTS idx_task_leases_expires_at");
        db.exec("DROP TABLE task_leases");
        db.exec("ALTER TABLE task_leases_v53 RENAME TO task_leases");
        db.exec(
          "CREATE INDEX IF NOT EXISTS idx_task_leases_expires_at ON task_leases(expires_at)",
        );

        log.info("[migration v53] task_leases.run_id FK restored");
      },
    },
  ];
}
