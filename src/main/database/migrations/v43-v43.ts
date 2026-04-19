import log from "electron-log/main.js";
import type { Migration, MigrationDeps } from "./types";
import { columnExists, tableExists } from "./types";

/**
 * Drop the Pi Mono-dead session carry-forward columns.
 *
 * The `task_sessions.session_params_json` / `task_sessions.session_display_id`
 * columns and the matching `runs.session_display_id` column were meaningful
 * in the CLI-adapter era: Gemini's resume id and provider-specific session
 * params rode the run-finished message back into the session row so the next
 * turn could resume. Pi Mono dispatches every provider through `pi-ai` and
 * emits neither value — the worker has been writing literal `null` on every
 * finish and `rotateSession` has been carrying `null` forward.
 *
 * Three columns of unused storage plus a hot path that writes them every
 * run. Drop them.
 *
 * The migration mirrors v41's "copy to new table, swap, reindex" shape —
 * SQLite still has no multi-column `DROP COLUMN`, and the task_sessions
 * index topology plus the runs secondary indexes need to be restored
 * identically. `PRAGMA foreign_keys` is disabled across the swap window
 * so child rows are not cascade-deleted mid-rebuild.
 */
export function createMigrationsV43V43(deps: MigrationDeps): Migration[] {
  const { db } = deps;
  return [
    {
      version: 43,
      name: "drop_dead_pi_mono_session_columns",
      fn: () => {
        const sessionsHasDeadCols =
          tableExists(db, "task_sessions") &&
          (columnExists(db, "task_sessions", "session_params_json") ||
            columnExists(db, "task_sessions", "session_display_id"));
        const runsHasDeadCol =
          tableExists(db, "runs") && columnExists(db, "runs", "session_display_id");

        if (!sessionsHasDeadCols && !runsHasDeadCol) {
          log.info("[migration v43] dead columns already absent; skipping");
          return;
        }

        db.exec("PRAGMA foreign_keys = OFF");
        try {
          if (sessionsHasDeadCols) {
            db.exec(`
              CREATE TABLE task_sessions_new (
                id TEXT PRIMARY KEY,
                company_id TEXT NOT NULL,
                agent_id TEXT NOT NULL,
                adapter_type TEXT NOT NULL,
                last_run_id TEXT,
                last_error TEXT,
                run_count INTEGER NOT NULL DEFAULT 0,
                total_input_tokens INTEGER NOT NULL DEFAULT 0,
                total_output_tokens INTEGER NOT NULL DEFAULT 0,
                rotated_at TEXT,
                rotation_reason TEXT,
                handoff_markdown TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
              );
              INSERT INTO task_sessions_new (
                id, company_id, agent_id, adapter_type, last_run_id, last_error,
                run_count, total_input_tokens, total_output_tokens, rotated_at,
                rotation_reason, handoff_markdown, created_at, updated_at
              )
              SELECT
                id, company_id, agent_id, adapter_type, last_run_id, last_error,
                run_count, total_input_tokens, total_output_tokens, rotated_at,
                rotation_reason, handoff_markdown, created_at, updated_at
              FROM task_sessions;
              DROP TABLE task_sessions;
              ALTER TABLE task_sessions_new RENAME TO task_sessions;
              CREATE INDEX IF NOT EXISTS idx_task_sessions_company_agent
                ON task_sessions(company_id, agent_id, updated_at);
              CREATE INDEX IF NOT EXISTS idx_task_sessions_lookup
                ON task_sessions(company_id, agent_id, adapter_type);
            `);
            log.info("[migration v43] rebuilt task_sessions without session_params_json/session_display_id");
          }

          if (runsHasDeadCol) {
            // `context_snapshot_json` rides through this rebuild untouched
            // so the single-concern invariant holds: v43 drops only
            // `session_display_id`. v44 is the one that drops the snapshot
            // column.
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
                context_snapshot_json TEXT,
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
                cost_usd, unattributed_cost, context_snapshot_json, actor_type,
                actor_id, started_at, finished_at, log_path, created_at, updated_at
              )
              SELECT
                id, company_id, task_id, agent_id, workspace_id, connector_id,
                status, summary, error_message, exit_code, signal, model,
                cost_usd, unattributed_cost, context_snapshot_json, actor_type,
                actor_id, started_at, finished_at, log_path, created_at, updated_at
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
            log.info("[migration v43] rebuilt runs without session_display_id");
          }
        } finally {
          db.exec("PRAGMA foreign_keys = ON");
        }
      },
    },
  ];
}
