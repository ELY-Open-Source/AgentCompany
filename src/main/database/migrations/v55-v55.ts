import log from "electron-log/main.js";
import type { Migration, MigrationDeps } from "./types";
import { columnExists, tableExists } from "./types";

export function createMigrationsV55V55(deps: MigrationDeps): Migration[] {
  const { db } = deps;
  return [
    {
      version: 55,
      name: "tasks_single_row_state",
      fn: () => {
        db.exec(`
          DROP TRIGGER IF EXISTS trg_tasks_phase_from_status_insert;
          DROP TRIGGER IF EXISTS trg_tasks_phase_from_status_update;
        `);

        if (tableExists(db, "task_leases")) {
          db.exec("DROP TABLE task_leases");
          log.info("[migration v55] task_leases shadow table dropped");
        }

        if (tableExists(db, "tasks") && columnExists(db, "tasks", "phase")) {
          db.exec("ALTER TABLE tasks DROP COLUMN phase");
          log.info("[migration v55] tasks.phase shadow column dropped");
        }
      },
    },
  ];
}
