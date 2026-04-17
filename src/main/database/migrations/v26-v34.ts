import { randomUUID } from "node:crypto";
import type { Migration, MigrationDeps } from "./types";
import { columnExists, tableExists } from "./types";

export function createMigrationsV26V34(deps: MigrationDeps): Migration[] {
  const { db, readAll } = deps;
  return [
    {
      version: 26, name: "add_source_run_id_for_causal_binding",
      sql: `ALTER TABLE documents ADD COLUMN source_run_id TEXT; ALTER TABLE knowledge_base ADD COLUMN source_run_id TEXT`,
    },
    {
      version: 27, name: "backfill_task_sessions_from_tasks_session_json",
      fn: () => {
        const legacyTasks = readAll<{
          id: string;
          companyId: string;
          assigneeAgentId: string | null;
          sessionJson: string;
          sessionDisplayId: string | null;
          updatedAt: string;
          connectorId: string | null;
        }>(
          `SELECT t.id AS id, t.company_id AS companyId, t.assignee_agent_id AS assigneeAgentId,
                  t.session_json AS sessionJson, t.session_display_id AS sessionDisplayId,
                  t.updated_at AS updatedAt, a.connector_id AS connectorId
             FROM tasks t
             LEFT JOIN agents a ON a.id = t.assignee_agent_id
            WHERE t.session_json IS NOT NULL
              AND t.id NOT IN (SELECT task_id FROM task_sessions)`,
        );
        for (const task of legacyTasks) {
          const sessionId = randomUUID();
          db.prepare(
            `INSERT OR IGNORE INTO task_sessions (id, company_id, task_id, agent_id, adapter_type, session_params_json, session_display_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            sessionId,
            task.companyId,
            task.id,
            task.assigneeAgentId ?? "unassigned",
            task.connectorId ?? "unknown",
            task.sessionJson,
            task.sessionDisplayId,
            task.updatedAt,
            task.updatedAt,
          );
          db.prepare(
            "UPDATE tasks SET active_session_id = ? WHERE id = ? AND active_session_id IS NULL",
          ).run(sessionId, task.id);
        }
      },
    },
    {
      version: 28, name: "add_snapshot_hot_path_indexes",
      fn: () => {
        // Some tables (task_comments / documents / meetings / sprints / agent_messages)
        // are created by ensureOptionalColumns, which runs AFTER runMigrations on
        // a fresh DB. Guard each CREATE INDEX with a tableExists check so the
        // migration is safe on both fresh and migrated databases.
        const indexPlan: Array<{ table: string; sql: string }> = [
          { table: "tasks", sql: "CREATE INDEX IF NOT EXISTS idx_tasks_company_created_at ON tasks(company_id, created_at DESC)" },
          { table: "tasks", sql: "CREATE INDEX IF NOT EXISTS idx_tasks_company_updated_at ON tasks(company_id, updated_at DESC)" },
          { table: "approvals", sql: "CREATE INDEX IF NOT EXISTS idx_approvals_company_created_at ON approvals(company_id, created_at DESC)" },
          { table: "task_comments", sql: "CREATE INDEX IF NOT EXISTS idx_task_comments_company_created_at ON task_comments(company_id, created_at)" },
          { table: "documents", sql: "CREATE INDEX IF NOT EXISTS idx_documents_company_updated_at ON documents(company_id, updated_at DESC)" },
          { table: "meetings", sql: "CREATE INDEX IF NOT EXISTS idx_meetings_company_scheduled_at ON meetings(company_id, scheduled_at DESC)" },
          { table: "sprints", sql: "CREATE INDEX IF NOT EXISTS idx_sprints_company_start_date ON sprints(company_id, start_date DESC)" },
          { table: "runs", sql: "CREATE INDEX IF NOT EXISTS idx_runs_agent_created_at ON runs(agent_id, created_at DESC)" },
          { table: "cost_entries", sql: "CREATE INDEX IF NOT EXISTS idx_cost_entries_agent_created_at ON cost_entries(agent_id, created_at DESC)" },
          { table: "activity", sql: "CREATE INDEX IF NOT EXISTS idx_activity_company_actor_action ON activity(company_id, actor, action)" },
          { table: "tasks", sql: "CREATE INDEX IF NOT EXISTS idx_tasks_company_assignee_status ON tasks(company_id, assignee_agent_id, status)" },
        ];
        for (const { table, sql } of indexPlan) {
          if (tableExists(db, table)) db.exec(sql);
        }
      },
    },
    {
      version: 29, name: "add_run_events_seq_unique_index",
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_run_events_run_seq_unique ON run_events(run_id, seq)`,
    },
    {
      // Supports checkpoint-engine `shouldPauseHeartbeat` join + filter on
      // (company_id, state, type) -> assignee_agent_id lookup. Without this
      // SQLite scans the full approvals table on every heartbeat tick.
      version: 30, name: "add_checkpoint_pause_indexes",
      sql: `CREATE INDEX IF NOT EXISTS idx_approvals_company_state_type ON approvals(company_id, state, type);
            CREATE INDEX IF NOT EXISTS idx_approvals_related_task ON approvals(related_task_id)`,
    },
    {
      // Typed seniority enum replaces English keyword substring matching for
      // leadership detection. Free-text `role` stays UI-editable; `role_level`
      // is inferred once on insert/update via inferRoleLevel().
      version: 31, name: "add_agents_role_level",
      fn: () => {
        if (!columnExists(db, "agents", "role_level")) {
          db.prepare("ALTER TABLE agents ADD COLUMN role_level TEXT NOT NULL DEFAULT 'ic'").run();
        }
      },
    },
    {
      // Explicit flag for synthesized heartbeat tasks. Replaces title-prefix
      // sniffing (`title LIKE '[Heartbeat]%'`) across queries, filters, and
      // automation gates. Backfills from existing `[Heartbeat]` titles so the
      // new column agrees with historical data on first boot.
      version: 33, name: "add_tasks_is_heartbeat",
      fn: () => {
        if (!columnExists(db, "tasks", "is_heartbeat")) {
          db.prepare("ALTER TABLE tasks ADD COLUMN is_heartbeat INTEGER NOT NULL DEFAULT 0").run();
        }
        db.prepare("UPDATE tasks SET is_heartbeat = 1 WHERE is_heartbeat = 0 AND title LIKE '[Heartbeat]%'").run();
        db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_is_heartbeat ON tasks(is_heartbeat)");
      },
    },
    {
      // pi-mono session transcripts + credential vault. Idempotent; safe to
      // re-apply on fresh DBs or DBs that already have the tables.
      version: 32, name: "create_pi_mono_session_and_credentials_tables",
      sql: `CREATE TABLE IF NOT EXISTS session_entries (
              id TEXT PRIMARY KEY,
              task_session_id TEXT NOT NULL,
              sequence INTEGER NOT NULL,
              kind TEXT NOT NULL,
              role TEXT,
              payload_json TEXT NOT NULL,
              is_superseded INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_session_entries_session ON session_entries(task_session_id, sequence);
            CREATE INDEX IF NOT EXISTS idx_session_entries_active ON session_entries(task_session_id, is_superseded, sequence);
            CREATE TABLE IF NOT EXISTS credentials (
              connector_id TEXT PRIMARY KEY,
              kind TEXT NOT NULL,
              backend TEXT NOT NULL,
              ciphertext BLOB NOT NULL,
              display_hint TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT 'active',
              expires_at TEXT,
              last_refreshed_at TEXT,
              last_error TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_credentials_status ON credentials(status)`,
    },
    {
      // Per-agent session scope. Agents carry a single active session across
      // tasks — switching tasks becomes a "now work on X" user turn on the
      // agent's ongoing transcript. Additive-only: existing task_sessions
      // rows remain as historical records; new runs use the agent-scoped
      // session created lazily on first post-upgrade run.
      version: 34, name: "add_agents_session_id",
      sql: `ALTER TABLE agents ADD COLUMN session_id TEXT;
            CREATE INDEX IF NOT EXISTS idx_agents_session_id ON agents(session_id)`,
    },
  ];
}
