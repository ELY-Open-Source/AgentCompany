import log from "electron-log/main.js";
import type { Migration, MigrationDeps } from "./types";
import { columnExists, tableExists } from "./types";

export function createMigrationsV45V45(deps: MigrationDeps): Migration[] {
  const { db } = deps;
  return [
    {
      // Promote work_products identity from `(company_id, provider, external_id)`
      // to `(company_id, workspace_id, provider, external_id)` and replace
      // the write-once `created_by_run_id` provenance with an append-only
      // `last_touched_by_run_id` so the deliverable judgment, the thread
      // projection, and the DocumentCenter open link all stay correct as
      // a file is rewritten across multiple runs.
      //
      // Pre-v45 behaviour silently collapsed two workspaces' files at the
      // same relative path into one row, and locked provenance at the
      // first run that touched the path — later edits were invisible to
      // `runProducedDeliverable`, so the task that produced the edit
      // could stay pinned in-progress.
      //
      // Backfill strategy: derive `workspace_id` per row via `task_id ->
      // tasks.workspace_id` first, then via `created_by_run_id ->
      // runs.workspace_id`. Rows with neither binding (historically the
      // exception, not the rule) remain NULL so nothing is dropped; the
      // new uniqueness constraint is scoped to rows with a workspace so
      // legacy NULL rows stay live without triggering conflicts.
      // `last_touched_by_run_id` is seeded to `created_by_run_id` so the
      // deliverable signal reads the same provenance pre- and post-
      // migration until the next write arrives.
      version: 45,
      name: "work_products_workspace_identity",
      fn: () => {
        if (!tableExists(db, "work_products")) {
          log.info("[migration v45] work_products table missing; skipping");
          return;
        }

        if (!columnExists(db, "work_products", "workspace_id")) {
          db.exec("ALTER TABLE work_products ADD COLUMN workspace_id TEXT");
        }
        if (!columnExists(db, "work_products", "last_touched_by_run_id")) {
          db.exec("ALTER TABLE work_products ADD COLUMN last_touched_by_run_id TEXT");
        }

        db.exec(`
          UPDATE work_products
          SET workspace_id = (
            SELECT tasks.workspace_id FROM tasks
            WHERE tasks.id = work_products.task_id
          )
          WHERE workspace_id IS NULL
            AND task_id IS NOT NULL
        `);

        db.exec(`
          UPDATE work_products
          SET workspace_id = (
            SELECT runs.workspace_id FROM runs
            WHERE runs.id = work_products.created_by_run_id
          )
          WHERE workspace_id IS NULL
            AND created_by_run_id IS NOT NULL
        `);

        db.exec(`
          UPDATE work_products
          SET last_touched_by_run_id = created_by_run_id
          WHERE last_touched_by_run_id IS NULL
            AND created_by_run_id IS NOT NULL
        `);

        db.exec(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_work_products_identity
          ON work_products(company_id, workspace_id, provider, external_id)
          WHERE workspace_id IS NOT NULL AND external_id IS NOT NULL
        `);

        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_work_products_last_touched
          ON work_products(company_id, last_touched_by_run_id)
        `);

        log.info("[migration v45] work_products identity + provenance upgraded");
      },
    },
  ];
}
