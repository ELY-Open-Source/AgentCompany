import log from "electron-log/main.js";
import type { Migration, MigrationDeps } from "./types";
import { tableExists } from "./types";

export function createMigrationsV40V40(deps: MigrationDeps): Migration[] {
  const { db } = deps;
  return [
    {
      // Relax work_products.task_id from NOT NULL to NULL-allowed.
      //
      // Background: every file that an agent writes via pi's write/edit tool
      // should be registered as a work product so the desktop UI surfaces
      // it. Heartbeat (taskless) runs — CEO team-building scratch memos,
      // research exploration — legitimately produce files with no owning
      // task. Forcing task_id NOT NULL made the artifact projector skip
      // these runs, which in turn made the UI look empty while the
      // workspace filesystem filled up with unregistered output.
      //
      // SQLite has no ALTER COLUMN, so we rebuild the table. The operation
      // is done inside a transaction; PRAGMA foreign_keys is disabled for
      // the rebuild window and restored afterward so child rows do not
      // cascade-delete when the old table is dropped mid-swap.
      version: 40,
      name: "relax_work_products_task_id",
      fn: () => {
        if (!tableExists(db, "work_products")) {
          log.info("[migration v40] work_products table missing; skipping");
          return;
        }
        const info = db.prepare("PRAGMA table_info(work_products)").all() as Array<{
          name: string;
          notnull: number;
        }>;
        const taskIdRow = info.find((row) => row.name === "task_id");
        if (!taskIdRow) {
          throw new Error("work_products.task_id column missing; refusing to migrate v40");
        }
        if (taskIdRow.notnull === 0) {
          log.info("[migration v40] work_products.task_id already nullable; skipping");
          return;
        }

        db.exec("PRAGMA foreign_keys = OFF");
        try {
          db.exec(`
            CREATE TABLE work_products_new (
              id TEXT PRIMARY KEY,
              company_id TEXT NOT NULL,
              project_id TEXT,
              task_id TEXT,
              type TEXT NOT NULL,
              provider TEXT NOT NULL,
              external_id TEXT,
              title TEXT NOT NULL,
              url TEXT,
              status TEXT NOT NULL DEFAULT 'active',
              review_state TEXT NOT NULL DEFAULT 'none',
              is_primary INTEGER NOT NULL DEFAULT 0,
              summary TEXT,
              metadata_json TEXT,
              created_by_run_id TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
            );
            INSERT INTO work_products_new (
              id, company_id, project_id, task_id, type, provider, external_id,
              title, url, status, review_state, is_primary, summary, metadata_json,
              created_by_run_id, created_at, updated_at
            )
            SELECT id, company_id, project_id, task_id, type, provider, external_id,
                   title, url, status, review_state, is_primary, summary, metadata_json,
                   created_by_run_id, created_at, updated_at
              FROM work_products;
            DROP TABLE work_products;
            ALTER TABLE work_products_new RENAME TO work_products;
            CREATE INDEX IF NOT EXISTS idx_work_products_task
              ON work_products(company_id, task_id, type);
            CREATE INDEX IF NOT EXISTS idx_work_products_updated
              ON work_products(company_id, updated_at);
          `);
        } finally {
          db.exec("PRAGMA foreign_keys = ON");
        }
        log.info("[migration v40] relaxed work_products.task_id to nullable");
      },
    },
  ];
}
