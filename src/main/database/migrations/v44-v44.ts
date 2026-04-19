import log from "electron-log/main.js";
import type { Migration, MigrationDeps } from "./types";
import { columnExists, tableExists } from "./types";

/**
 * Drop `runs.context_snapshot_json` — dead since its introduction.
 *
 * v16-v25 added the column with the intent to snapshot the turn context
 * for post-run forensics. Nothing ever wrote to it, nothing ever read it,
 * and the Pi Mono migration removed the last plausible use case (the
 * turn snapshot now lives in `task_sessions` / `session_entries`).
 *
 * Same table-rebuild pattern as v43 — `runs_new` without the column,
 * copy the real data, swap, reindex. Idempotent: if the column is
 * already absent the migration is a no-op.
 */
export function createMigrationsV44V44(deps: MigrationDeps): Migration[] {
  const { db } = deps;
  return [
    {
      version: 44,
      name: "drop_runs_context_snapshot_json",
      fn: () => {
        if (!tableExists(db, "runs") || !columnExists(db, "runs", "context_snapshot_json")) {
          log.info("[migration v44] runs.context_snapshot_json already absent; skipping");
          return;
        }

        db.exec("PRAGMA foreign_keys = OFF");
        try {
          db.exec(`
            CREATE TABLE runs_new (
              id TEXT PRIMARY KEY,
              company_id TEXT NOT NULL,
              task_id TEXT,
              agent_id TEXT NOT NULL,
              workspace_id TEXT,
              connector_id TEXT NOT NULL,
              status TEXT NOT NULL,
              summary TEXT NOT NULL,
              error_message TEXT,
              exit_code INTEGER,
              signal TEXT,
              model TEXT,
              cost_usd REAL,
              unattributed_cost INTEGER NOT NULL DEFAULT 0,
              actor_type TEXT,
              actor_id TEXT,
              started_at TEXT,
              finished_at TEXT,
              log_path TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            INSERT INTO runs_new (
              id, company_id, task_id, agent_id, workspace_id, connector_id,
              status, summary, error_message, exit_code, signal, model,
              cost_usd, unattributed_cost, actor_type, actor_id,
              started_at, finished_at, log_path, created_at, updated_at
            )
            SELECT
              id, company_id, task_id, agent_id, workspace_id, connector_id,
              status, summary, error_message, exit_code, signal, model,
              cost_usd, unattributed_cost, actor_type, actor_id,
              started_at, finished_at, log_path, created_at, updated_at
            FROM runs;
            DROP TABLE runs;
            ALTER TABLE runs_new RENAME TO runs;
            CREATE INDEX IF NOT EXISTS idx_runs_company ON runs(company_id);
            CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id);
            CREATE INDEX IF NOT EXISTS idx_runs_agent ON runs(agent_id);
            CREATE INDEX IF NOT EXISTS idx_runs_company_status ON runs(company_id, status);
            CREATE INDEX IF NOT EXISTS idx_runs_company_created_at ON runs(company_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_runs_agent_created_at ON runs(agent_id, created_at DESC);
          `);
          log.info("[migration v44] rebuilt runs without context_snapshot_json");
        } finally {
          db.exec("PRAGMA foreign_keys = ON");
        }
      },
    },
  ];
}
