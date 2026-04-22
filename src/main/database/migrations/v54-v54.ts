import log from "electron-log/main.js";
import type { Migration, MigrationDeps } from "./types";
import { columnExists, tableExists } from "./types";

export function createMigrationsV54V54(deps: MigrationDeps): Migration[] {
  const { db } = deps;
  return [
    {
      version: 54,
      name: "runs_usage_status",
      fn: () => {
        if (!tableExists(db, "runs")) {
          log.info("[migration v54] runs table missing; nothing to do");
          return;
        }

        if (!columnExists(db, "runs", "usage_status")) {
          db.exec("ALTER TABLE runs ADD COLUMN usage_status TEXT NOT NULL DEFAULT 'pre_first_message'");
          log.info("[migration v54] runs.usage_status column added");
        }

        db.exec(`
          UPDATE runs
             SET usage_status = CASE
               WHEN unattributed_cost = 0 THEN 'ok'
               WHEN status IN ('cancelled', 'interrupted') THEN 'aborted_before_usage'
               ELSE 'pre_first_message'
             END
           WHERE usage_status = 'pre_first_message'
        `);
      },
    },
  ];
}
