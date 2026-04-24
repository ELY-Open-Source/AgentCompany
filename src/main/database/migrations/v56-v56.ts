import log from "electron-log/main.js";
import type { Migration, MigrationDeps } from "./types";
import { tableExists } from "./types";

export function createMigrationsV56V56(deps: MigrationDeps): Migration[] {
  const { db } = deps;
  return [
    {
      version: 56,
      name: "work_products_primary_invariant",
      fn: () => {
        if (!tableExists(db, "work_products")) {
          log.info("[migration v56] work_products table missing; skipping");
          return;
        }

        db.exec(`
          UPDATE work_products
          SET is_primary = 0,
              updated_at = datetime('now')
          WHERE id IN (
            SELECT id FROM (
              SELECT
                id,
                row_number() OVER (
                  PARTITION BY company_id, task_id, type
                  ORDER BY updated_at DESC, created_at DESC, id DESC
                ) AS rank_in_group
              FROM work_products
              WHERE task_id IS NOT NULL
                AND is_primary = 1
                AND status <> 'archived'
            )
            WHERE rank_in_group > 1
          );

          CREATE UNIQUE INDEX IF NOT EXISTS idx_work_products_primary_active
          ON work_products(company_id, task_id, type)
          WHERE task_id IS NOT NULL
            AND is_primary = 1
            AND status <> 'archived';
        `);

        log.info("[migration v56] work_products active primary invariant installed");
      },
    },
  ];
}
