import log from "electron-log/main.js";
import type { Migration, MigrationDeps } from "./types";
import { columnExists, tableExists } from "./types";

/**
 * Drop dead columns left behind by the agent-scoped session refactor.
 *
 * Pre-v34, a session belonged to a task; the schema reflected that
 * with `tasks.active_session_id`, `tasks.session_json`,
 * `tasks.session_display_id`, and a `task_sessions.task_id` FK back to
 * tasks. Since v34, sessions are agent-scoped — `agents.session_id`
 * is the canonical pointer, and every runtime read goes through that
 * or through the session's primary key. The four columns have been
 * dead storage ever since, and every touch of session code had to
 * pretend they were still meaningful.
 *
 * This migration rebuilds both tables without those columns. SQLite
 * has no `ALTER TABLE DROP COLUMN` that drops multiple columns
 * atomically and preserves every constraint; the "copy to new table,
 * swap, reindex" pattern is the only safe route. `PRAGMA foreign_keys`
 * is disabled for the swap window and restored afterward so child
 * tables are not cascade-deleted mid-rebuild.
 *
 * The migration is idempotent: each table rebuild checks whether the
 * dead columns are still present and skips the work otherwise.
 */
export function createMigrationsV41V41(deps: MigrationDeps): Migration[] {
  const { db } = deps;
  return [
    {
      version: 41,
      name: "drop_dead_session_columns",
      fn: () => {
        if (!tableExists(db, "tasks") || !tableExists(db, "task_sessions")) {
          log.info("[migration v41] tasks or task_sessions table missing; skipping");
          return;
        }

        const tasksHasDeadCols =
          columnExists(db, "tasks", "session_json") ||
          columnExists(db, "tasks", "session_display_id") ||
          columnExists(db, "tasks", "active_session_id");
        const sessionsHasDeadCol = columnExists(db, "task_sessions", "task_id");

        if (!tasksHasDeadCols && !sessionsHasDeadCol) {
          log.info("[migration v41] dead columns already absent; skipping");
          return;
        }

        // The `ensureOptionalColumns` helper in schema.ts normally
        // backfills `task_type`, `requires_user_review`, `retry_count`,
        // `last_failure_at` on existing installs — but that runs AFTER
        // migrations, not before. Rebuild the table here with the same
        // shape as the post-ensureOptionalColumns schema so the old data
        // is preserved and the new table stays consistent whether
        // initializeDatabase has reached ensureOptionalColumns yet or not.
        const ensureTaskCol = (column: string, typeSql: string) => {
          if (!columnExists(db, "tasks", column)) {
            db.prepare(`ALTER TABLE tasks ADD COLUMN ${column} ${typeSql}`).run();
          }
        };
        ensureTaskCol("task_type", "TEXT NOT NULL DEFAULT 'general'");
        ensureTaskCol("requires_user_review", "INTEGER NOT NULL DEFAULT 0");
        ensureTaskCol("retry_count", "INTEGER NOT NULL DEFAULT 0");
        ensureTaskCol("last_failure_at", "TEXT");
        ensureTaskCol("checkout_run_id", "TEXT");
        ensureTaskCol("execution_locked_at", "TEXT");
        ensureTaskCol("started_at", "TEXT");
        ensureTaskCol("completed_at", "TEXT");
        ensureTaskCol("cancelled_at", "TEXT");

        db.exec("PRAGMA foreign_keys = OFF");
        try {
          if (tasksHasDeadCols) {
            db.exec(`
              CREATE TABLE tasks_new (
                id TEXT PRIMARY KEY,
                company_id TEXT NOT NULL,
                project_id TEXT,
                goal_id TEXT,
                parent_id TEXT,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                assignee_agent_id TEXT,
                workspace_id TEXT,
                status TEXT NOT NULL,
                priority TEXT NOT NULL,
                active_run_id TEXT,
                cost_usd REAL NOT NULL DEFAULT 0,
                task_type TEXT NOT NULL DEFAULT 'general',
                requires_user_review INTEGER NOT NULL DEFAULT 0,
                retry_count INTEGER NOT NULL DEFAULT 0,
                last_failure_at TEXT,
                checkout_run_id TEXT,
                execution_locked_at TEXT,
                started_at TEXT,
                completed_at TEXT,
                cancelled_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
              );
              INSERT INTO tasks_new (
                id, company_id, project_id, goal_id, parent_id, title, description,
                assignee_agent_id, workspace_id, status, priority, active_run_id,
                cost_usd, task_type, requires_user_review, retry_count, last_failure_at,
                checkout_run_id, execution_locked_at, started_at, completed_at,
                cancelled_at, created_at, updated_at
              )
              SELECT
                id, company_id, project_id, goal_id, parent_id, title, description,
                assignee_agent_id, workspace_id, status, priority, active_run_id,
                cost_usd, task_type, requires_user_review, retry_count, last_failure_at,
                checkout_run_id, execution_locked_at, started_at, completed_at,
                cancelled_at, created_at, updated_at
              FROM tasks;
              DROP TABLE tasks;
              ALTER TABLE tasks_new RENAME TO tasks;
              CREATE INDEX IF NOT EXISTS idx_tasks_company ON tasks(company_id);
              CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_agent_id);
              CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
              CREATE INDEX IF NOT EXISTS idx_tasks_company_status ON tasks(company_id, status);
            `);
            log.info("[migration v41] rebuilt tasks without session_json/session_display_id/active_session_id");
          }

          if (sessionsHasDeadCol) {
            db.exec(`
              CREATE TABLE task_sessions_new (
                id TEXT PRIMARY KEY,
                company_id TEXT NOT NULL,
                agent_id TEXT NOT NULL,
                adapter_type TEXT NOT NULL,
                session_params_json TEXT,
                session_display_id TEXT,
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
                id, company_id, agent_id, adapter_type, session_params_json,
                session_display_id, last_run_id, last_error, run_count,
                total_input_tokens, total_output_tokens, rotated_at, rotation_reason,
                handoff_markdown, created_at, updated_at
              )
              SELECT
                id, company_id, agent_id, adapter_type, session_params_json,
                session_display_id, last_run_id, last_error, run_count,
                total_input_tokens, total_output_tokens, rotated_at, rotation_reason,
                handoff_markdown, created_at, updated_at
              FROM task_sessions;
              DROP TABLE task_sessions;
              ALTER TABLE task_sessions_new RENAME TO task_sessions;
              CREATE INDEX IF NOT EXISTS idx_task_sessions_company_agent
                ON task_sessions(company_id, agent_id, updated_at);
              CREATE INDEX IF NOT EXISTS idx_task_sessions_lookup
                ON task_sessions(company_id, agent_id, adapter_type);
            `);
            log.info("[migration v41] rebuilt task_sessions without task_id");
          }
        } finally {
          db.exec("PRAGMA foreign_keys = ON");
        }
      },
    },
  ];
}
