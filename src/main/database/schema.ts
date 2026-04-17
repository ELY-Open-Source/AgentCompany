import { randomUUID } from "node:crypto";
import log from "electron-log/main.js";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";

type ReadAll = <T>(sql: string, ...params: SQLInputValue[]) => T[];
type Transaction = <T>(operation: () => T) => T;

function nowIso() {
  return new Date().toISOString();
}

function columnExists(db: DatabaseSync, table: string, column: string): boolean {
  const rows = db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function tableExists(db: DatabaseSync, table: string): boolean {
  const row = db
    .prepare("select name from sqlite_master where type = 'table' and name = ?")
    .get(table) as { name: string } | undefined;
  return !!row;
}

export function ensureOptionalColumns(db: DatabaseSync) {
  const addColumnIfMissing = (table: string, column: string, sql: string) => {
    if (!columnExists(db, table, column)) db.prepare(sql).run();
  };
  addColumnIfMissing("connectors", "updated_at", "alter table connectors add column updated_at text");
  addColumnIfMissing("approvals", "payload_json", "alter table approvals add column payload_json text");
  addColumnIfMissing("agents", "heartbeat_enabled", "alter table agents add column heartbeat_enabled integer not null default 0");
  addColumnIfMissing("agents", "heartbeat_interval_sec", "alter table agents add column heartbeat_interval_sec integer not null default 120");
  addColumnIfMissing("agents", "last_heartbeat_at", "alter table agents add column last_heartbeat_at text");
  addColumnIfMissing("companies", "auto_approve_hires", "alter table companies add column auto_approve_hires integer not null default 0");
  addColumnIfMissing("companies", "review_deliverables", "alter table companies add column review_deliverables integer not null default 0");
  addColumnIfMissing("companies", "execution_mode", "alter table companies add column execution_mode text not null default 'ai_ceo'");
  addColumnIfMissing("tasks", "task_type", "alter table tasks add column task_type text not null default 'general'");
  addColumnIfMissing("tasks", "requires_user_review", "alter table tasks add column requires_user_review integer not null default 0");
  addColumnIfMissing("tasks", "retry_count", "alter table tasks add column retry_count integer not null default 0");
  addColumnIfMissing("tasks", "last_failure_at", "alter table tasks add column last_failure_at text");
  addColumnIfMissing("tasks", "checkout_run_id", "alter table tasks add column checkout_run_id text");
  addColumnIfMissing("tasks", "execution_locked_at", "alter table tasks add column execution_locked_at text");
  addColumnIfMissing("tasks", "active_session_id", "alter table tasks add column active_session_id text");
  addColumnIfMissing("cost_entries", "project_id", "alter table cost_entries add column project_id text");
  db.exec(`
    create table if not exists task_comments (id text primary key, company_id text not null, task_id text not null, author_agent_id text, author_name text not null, body text not null, created_at text not null);
    create index if not exists idx_comments_task on task_comments(task_id);
    create index if not exists idx_comments_company on task_comments(company_id);
  `);
  db.exec(`
    create table if not exists social_accounts (id text primary key, company_id text not null references companies(id) on delete cascade, platform text not null default 'other', account_name text not null, display_name text not null default '', profile_url text not null default '', credential_secret_id text, status text not null default 'login_required', require_approval integer not null default 1, metadata_json text not null default '{}', last_used_at text, created_at text not null default (datetime('now')), updated_at text not null default (datetime('now')));
    create index if not exists idx_social_accounts_company on social_accounts(company_id);
  `);
  db.exec(`
    create table if not exists browser_actions (id text primary key, company_id text not null references companies(id) on delete cascade, social_account_id text not null references social_accounts(id) on delete cascade, agent_id text not null references agents(id) on delete cascade, task_id text, action_type text not null default 'custom_script', payload_json text not null default '{}', status text not null default 'queued', result_summary text not null default '', screenshot_path text, approval_id text, error_message text, started_at text, finished_at text, created_at text not null default (datetime('now')), updated_at text not null default (datetime('now')));
    create index if not exists idx_browser_actions_company on browser_actions(company_id);
    create index if not exists idx_browser_actions_account on browser_actions(social_account_id);
  `);
  if (tableExists(db, "agent_messages")) {
    db.exec(`
      create index if not exists idx_messages_company on agent_messages(company_id);
      create index if not exists idx_messages_channel on agent_messages(channel, channel_target_id);
    `);
  }
  if (tableExists(db, "automation_rules")) {
    db.exec(`create index if not exists idx_automation_rules_company_status on automation_rules(company_id, status);`);
  }
  if (tableExists(db, "automation_log")) {
    db.exec(`create index if not exists idx_automation_log_company on automation_log(company_id);`);
  }
}

export function migrateSecretsTable(db: DatabaseSync, readAll: ReadAll) {
  const columns = readAll<{ name: string }>("pragma table_info(secrets)");
  if (columns.some((column) => column.name === "company_id")) {
    db.prepare("create unique index if not exists secrets_company_name_idx on secrets(company_id, name)").run();
    return;
  }
  const fallbackCompanyId =
    ((db.prepare("select value from settings where key = 'current_company_id'").get() as { value: string } | undefined)?.value) ??
    ((db.prepare("select id from companies order by created_at asc limit 1").get() as { id: string } | undefined)?.id) ??
    "00000000-0000-0000-0000-000000000000";
  db.exec(`
    alter table secrets rename to secrets_legacy;
    create table secrets (id text primary key, company_id text not null, name text not null, description text not null, backend text not null, ciphertext blob not null, updated_at text not null, created_at text not null, unique(company_id, name));
  `);
  db.prepare("insert into secrets (id, company_id, name, description, backend, ciphertext, updated_at, created_at) select id, ?, name, description, backend, ciphertext, updated_at, created_at from secrets_legacy").run(fallbackCompanyId);
  db.exec("drop table secrets_legacy;");
}

export function initializeDatabase(db: DatabaseSync, ra: ReadAll, tx: Transaction): void {
  db.exec(`
      create table if not exists settings (key text primary key, value text not null);
      create table if not exists companies (id text primary key, name text not null, description text not null, status text not null, created_at text not null, updated_at text not null);
      create table if not exists connectors (id text primary key, label text not null, description text not null, status text not null, command text not null, version text, auth_state text not null, last_checked_at text, last_error text, model text, env_binding_text text not null, notes text not null, updated_at text);
      create table if not exists workspaces (id text primary key, company_id text not null, name text not null, local_path text not null, repo_url text not null, repo_ref text not null, project_id text, state text not null, is_primary integer not null default 0, created_at text not null, updated_at text not null);
      create table if not exists agents (id text primary key, company_id text not null, name text not null, role text not null, title text not null, status text not null, reports_to text, connector_id text not null, workspace_id text, model text, capabilities text not null, budget_monthly_usd real not null default 0, spent_monthly_usd real not null default 0, metadata_json text not null default '{}', created_at text not null, updated_at text not null);
      create table if not exists goals (id text primary key, company_id text not null, title text not null, description text not null, parent_id text, owner_agent_id text, status text not null, created_at text not null, updated_at text not null);
      create table if not exists projects (id text primary key, company_id text not null, goal_id text, name text not null, description text not null, lead_agent_id text, status text not null, target_date text, created_at text not null, updated_at text not null);
      create table if not exists tasks (id text primary key, company_id text not null, project_id text, goal_id text, parent_id text, title text not null, description text not null, assignee_agent_id text, workspace_id text, status text not null, priority text not null, active_run_id text, session_json text, session_display_id text, cost_usd real not null default 0, created_at text not null, updated_at text not null);
      create table if not exists approvals (id text primary key, company_id text not null, related_task_id text, requested_by_agent_id text, type text not null, payload_summary text not null, impact_summary text not null, payload_json text, decision_note text not null default '', state text not null, created_at text not null, updated_at text not null);
      create table if not exists runs (id text primary key, company_id text not null, task_id text not null, agent_id text not null, workspace_id text, connector_id text not null, status text not null, summary text not null, error_message text, exit_code integer, signal text, model text, session_display_id text, cost_usd real, unattributed_cost integer not null default 0, started_at text, finished_at text, log_path text, created_at text not null, updated_at text not null);
      create table if not exists cost_entries (id text primary key, company_id text not null, run_id text not null, task_id text, agent_id text, connector_id text not null, amount_usd real, unattributed integer not null default 0, created_at text not null);
      create table if not exists activity (id text primary key, company_id text not null, actor text not null, action text not null, entity_type text not null, entity_id text not null, detail text not null, created_at text not null);
      create table if not exists secrets (id text primary key, company_id text not null, name text not null, description text not null, backend text not null, ciphertext blob not null, updated_at text not null, created_at text not null, unique(company_id, name));
    `);

  db.exec(`
      create index if not exists idx_workspaces_company on workspaces(company_id);
      create index if not exists idx_agents_company on agents(company_id);
      create index if not exists idx_goals_company on goals(company_id);
      create index if not exists idx_projects_company on projects(company_id);
      create index if not exists idx_tasks_company on tasks(company_id);
      create index if not exists idx_tasks_assignee on tasks(assignee_agent_id);
      create index if not exists idx_tasks_project on tasks(project_id);
      create index if not exists idx_approvals_company on approvals(company_id);
      create index if not exists idx_runs_company on runs(company_id);
      create index if not exists idx_runs_task on runs(task_id);
      create index if not exists idx_runs_agent on runs(agent_id);
      create index if not exists idx_cost_entries_company on cost_entries(company_id);
      create index if not exists idx_cost_entries_run on cost_entries(run_id);
      create index if not exists idx_activity_company on activity(company_id);
      create index if not exists idx_tasks_company_status on tasks(company_id, status);
      create index if not exists idx_agents_company_status on agents(company_id, status);
      create index if not exists idx_agents_reports_to on agents(reports_to);
      create index if not exists idx_runs_company_status on runs(company_id, status);
      create index if not exists idx_approvals_company_state on approvals(company_id, state);
    `);

  db.exec(`
      create table if not exists pending_wakes (id text primary key, company_id text not null, agent_id text not null, trigger_reason text not null, created_at text not null);
      create index if not exists idx_pending_wakes_agent on pending_wakes(agent_id);
    `);

  db.exec(`
      CREATE TABLE IF NOT EXISTS wakeup_requests (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, agent_id TEXT NOT NULL, source TEXT NOT NULL, trigger_detail TEXT, reason TEXT, payload TEXT, status TEXT NOT NULL DEFAULT 'queued', coalesced_count INTEGER NOT NULL DEFAULT 0, requested_by_actor_type TEXT, requested_by_actor_id TEXT, idempotency_key TEXT, run_id TEXT, requested_at TEXT NOT NULL, claimed_at TEXT, finished_at TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_wakeup_requests_agent ON wakeup_requests(agent_id, company_id, status);
    `);

  migrateSecretsTable(db, ra);
  db.exec(`create index if not exists idx_secrets_company on secrets(company_id);`);
  runMigrations(db, ra, tx);
  ensureOptionalColumns(db);

  db.exec(`
      create index if not exists idx_agents_department on agents(company_id, department);
      create index if not exists idx_runs_company_created_at on runs(company_id, created_at desc);
      create index if not exists idx_cost_entries_company_created_at on cost_entries(company_id, created_at desc);
      create index if not exists idx_activity_company_created_at on activity(company_id, created_at desc);
      create index if not exists idx_agent_messages_company_created_at on agent_messages(company_id, created_at desc);
    `);

  seedSettings(db);
}

export function seedSettings(db: DatabaseSync) {
  const getSetting = (key: string): string | null => {
    const row = db.prepare("select value from settings where key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  };
  const setSetting = (key: string, value: string) => {
    db.prepare("insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value").run(key, value);
  };
  if (!getSetting("theme")) setSetting("theme", "system");
  if (!getSetting("updates_enabled")) setSetting("updates_enabled", "false");
  if (!getSetting("log_retention_days")) setSetting("log_retention_days", "90");
}

export function runMigrations(
  db: DatabaseSync,
  readAll: ReadAll,
  transaction: Transaction,
) {
  db.exec(`create table if not exists schema_migrations (version integer primary key, name text not null, applied_at text not null);`);
  const applied = new Set(readAll<{ version: number }>("select version from schema_migrations").map((row) => row.version));

  const migrations: Array<{ version: number; name: string; sql?: string; fn?: () => void }> = [
    { version: 1, name: "add_workspace_lock_lease", sql: `alter table workspaces add column lock_holder_run_id text; alter table workspaces add column lock_acquired_at text` },
    { version: 2, name: "add_approval_related_agent_id", sql: `alter table approvals add column related_agent_id text` },
    { version: 3, name: "add_profile_metadata", sql: `insert or ignore into settings (key, value) values ('profile_version', '1'); insert or ignore into settings (key, value) values ('profile_created_at', '${nowIso()}')` },
    { version: 4, name: "add_connector_capability_snapshot", sql: `alter table connectors add column capability_json text` },
    { version: 6, name: "add_agent_department", sql: `alter table agents add column department text` },
    { version: 7, name: "add_meetings_table", sql: `create table if not exists meetings (id text primary key, company_id text not null, type text not null, title text not null, organizer_agent_id text, participant_agent_ids text not null default '[]', scheduled_at text not null, duration_minutes integer not null default 30, agenda_json text not null default '[]', notes_json text not null default '[]', decisions_json text not null default '[]', action_items_json text not null default '[]', status text not null default 'scheduled', created_at text not null, updated_at text not null); create index if not exists idx_meetings_company on meetings(company_id); create index if not exists idx_meetings_organizer on meetings(organizer_agent_id)` },
    { version: 8, name: "add_documents_table", sql: `create table if not exists documents (id text primary key, company_id text not null, type text not null, title text not null, content text not null default '', author_agent_id text, reviewer_agent_id text, project_id text, goal_id text, parent_doc_id text, version integer not null default 1, status text not null default 'draft', tags_json text not null default '[]', created_at text not null, updated_at text not null); create index if not exists idx_documents_company on documents(company_id); create index if not exists idx_documents_author on documents(author_agent_id); create index if not exists idx_documents_project on documents(project_id)` },
    { version: 9, name: "add_knowledge_base_table", sql: `create table if not exists knowledge_base (id text primary key, company_id text not null, category text not null, topic text not null, content text not null, author_agent_id text, importance text not null default 'medium', tags_json text not null default '[]', referenced_entity_type text, referenced_entity_id text, created_at text not null, updated_at text not null); create index if not exists idx_knowledge_company on knowledge_base(company_id); create index if not exists idx_knowledge_category on knowledge_base(category)` },
    { version: 10, name: "add_sprints_table", sql: `create table if not exists sprints (id text primary key, company_id text not null, name text not null, goal text not null default '', start_date text not null, end_date text not null, status text not null default 'planning', retrospective_notes text not null default '', velocity_points integer not null default 0, completed_points integer not null default 0, created_at text not null, updated_at text not null); create index if not exists idx_sprints_company on sprints(company_id)` },
    { version: 11, name: "add_automation_messages_workflows", sql: `create table if not exists automation_rules (id text primary key, company_id text not null, name text not null, description text not null default '', trigger text not null, conditions_json text not null default '{}', action text not null, action_config_json text not null default '{}', source_department text, target_department text, priority integer not null default 50, status text not null default 'active', execution_count integer not null default 0, last_executed_at text, created_at text not null, updated_at text not null); create index if not exists idx_automation_rules_company on automation_rules(company_id); create index if not exists idx_automation_rules_trigger on automation_rules(trigger); create table if not exists agent_messages (id text primary key, company_id text not null, from_agent_id text not null, to_agent_id text, channel text not null default 'direct', channel_target_id text, subject text not null, body text not null, priority text not null default 'normal', read_at text, parent_message_id text, attachments_json text not null default '[]', created_at text not null); create index if not exists idx_agent_messages_company on agent_messages(company_id); create index if not exists idx_agent_messages_to on agent_messages(to_agent_id); create index if not exists idx_agent_messages_from on agent_messages(from_agent_id); create index if not exists idx_agent_messages_channel on agent_messages(channel); create table if not exists workflow_pipelines (id text primary key, company_id text not null, name text not null, description text not null default '', steps_json text not null default '[]', trigger_type text not null, trigger_config_json text not null default '{}', status text not null default 'draft', current_step_index integer not null default 0, run_count integer not null default 0, last_run_at text, created_at text not null, updated_at text not null); create index if not exists idx_workflows_company on workflow_pipelines(company_id); create table if not exists automation_log (id text primary key, company_id text not null, rule_id text not null, rule_name text not null, trigger text not null, action text not null, detail text not null default '', executed_at text not null); create index if not exists idx_automation_log_company on automation_log(company_id)` },
    { version: 12, name: "add_agent_message_reads", sql: `create table if not exists agent_message_reads (message_id text not null, agent_id text not null, read_at text not null, primary key (message_id, agent_id)); create index if not exists idx_agent_message_reads_agent on agent_message_reads(agent_id)` },
    { version: 13, name: "add_checkout_session_budget_columns", sql: `ALTER TABLE tasks ADD COLUMN checkout_run_id TEXT; ALTER TABLE tasks ADD COLUMN execution_locked_at TEXT; ALTER TABLE tasks ADD COLUMN active_session_id TEXT; ALTER TABLE cost_entries ADD COLUMN project_id TEXT; CREATE INDEX IF NOT EXISTS idx_cost_entries_project ON cost_entries(project_id)` },
    { version: 14, name: "create_skills_budget_wakeup_session_tables", sql: `CREATE TABLE IF NOT EXISTS company_skills (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, key TEXT NOT NULL, slug TEXT NOT NULL, name TEXT NOT NULL, description TEXT, markdown TEXT NOT NULL DEFAULT '', source_type TEXT NOT NULL DEFAULT 'local_path', source_locator TEXT, source_ref TEXT, trust_level TEXT NOT NULL DEFAULT 'markdown_only', compatibility TEXT NOT NULL DEFAULT 'compatible', file_inventory TEXT NOT NULL DEFAULT '[]', metadata TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE UNIQUE INDEX IF NOT EXISTS idx_company_skills_company_key ON company_skills(company_id, key); CREATE INDEX IF NOT EXISTS idx_company_skills_company_name ON company_skills(company_id, name); CREATE TABLE IF NOT EXISTS budget_policies (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, metric TEXT NOT NULL DEFAULT 'billed_cents', window_kind TEXT NOT NULL DEFAULT 'calendar_month_utc', amount INTEGER NOT NULL DEFAULT 0, warn_percent INTEGER NOT NULL DEFAULT 80, hard_stop_enabled INTEGER NOT NULL DEFAULT 1, notify_enabled INTEGER NOT NULL DEFAULT 1, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_budget_policies_company_scope ON budget_policies(company_id, scope_type, scope_id, is_active); CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_policies_unique ON budget_policies(company_id, scope_type, scope_id, metric, window_kind); CREATE TABLE IF NOT EXISTS budget_incidents (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, policy_id TEXT NOT NULL REFERENCES budget_policies(id), scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, metric TEXT NOT NULL, window_kind TEXT NOT NULL, window_start TEXT NOT NULL, window_end TEXT NOT NULL, threshold_type TEXT NOT NULL, amount_limit INTEGER NOT NULL, amount_observed INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', resolved_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_budget_incidents_company_status ON budget_incidents(company_id, status); CREATE INDEX IF NOT EXISTS idx_budget_incidents_company_scope ON budget_incidents(company_id, scope_type, scope_id, status); CREATE INDEX IF NOT EXISTS idx_budget_incidents_policy ON budget_incidents(policy_id, window_start, threshold_type); CREATE TABLE IF NOT EXISTS task_sessions (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, task_id TEXT NOT NULL, agent_id TEXT NOT NULL, adapter_type TEXT NOT NULL, session_params_json TEXT, session_display_id TEXT, last_run_id TEXT, last_error TEXT, run_count INTEGER NOT NULL DEFAULT 0, total_input_tokens INTEGER NOT NULL DEFAULT 0, total_output_tokens INTEGER NOT NULL DEFAULT 0, rotated_at TEXT, rotation_reason TEXT, handoff_markdown TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_task_sessions_lookup ON task_sessions(company_id, agent_id, adapter_type, task_id); CREATE INDEX IF NOT EXISTS idx_task_sessions_company_agent ON task_sessions(company_id, agent_id, updated_at); CREATE INDEX IF NOT EXISTS idx_task_sessions_company_task ON task_sessions(company_id, task_id, updated_at); CREATE TABLE IF NOT EXISTS wakeup_requests (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, agent_id TEXT NOT NULL, source TEXT NOT NULL, trigger_detail TEXT, reason TEXT, payload TEXT, status TEXT NOT NULL DEFAULT 'queued', coalesced_count INTEGER NOT NULL DEFAULT 0, requested_by_actor_type TEXT, requested_by_actor_id TEXT, idempotency_key TEXT, run_id TEXT, requested_at TEXT NOT NULL, claimed_at TEXT, finished_at TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_wakeup_requests_company_agent_status ON wakeup_requests(company_id, agent_id, status); CREATE INDEX IF NOT EXISTS idx_wakeup_requests_company_requested ON wakeup_requests(company_id, requested_at); CREATE INDEX IF NOT EXISTS idx_wakeup_requests_agent_requested ON wakeup_requests(agent_id, requested_at)` },
    {
      version: 15, name: "migrate_session_data_to_task_sessions",
      fn: () => {
        const tasksWithSessions = readAll<{ id: string; companyId: string; assigneeAgentId: string | null; sessionJson: string | null; sessionDisplayId: string | null }>(
          `SELECT id, company_id as companyId, assignee_agent_id as assigneeAgentId, session_json as sessionJson, session_display_id as sessionDisplayId FROM tasks WHERE session_json IS NOT NULL AND active_session_id IS NULL`,
        );
        let migrated = 0;
        let skipped = 0;
        for (const task of tasksWithSessions) {
          try {
            if (!task.sessionJson) continue;
            JSON.parse(task.sessionJson);
            const agent = task.assigneeAgentId ? db.prepare("SELECT connector_id FROM agents WHERE id = ?").get(task.assigneeAgentId) as { connector_id: string } | undefined : undefined;
            const adapterType = agent?.connector_id ?? "unknown";
            const sessionId = randomUUID();
            const ts = nowIso();
            db.prepare(`INSERT INTO task_sessions (id, company_id, task_id, agent_id, adapter_type, session_params_json, session_display_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(sessionId, task.companyId, task.id, task.assigneeAgentId ?? "unassigned", adapterType, task.sessionJson, task.sessionDisplayId, ts, ts);
            db.prepare("UPDATE tasks SET active_session_id = ? WHERE id = ?").run(sessionId, task.id);
            migrated++;
          } catch (err) {
            log.warn(`Session migration skipped task ${task.id}: ${err instanceof Error ? err.message : String(err)}`);
            skipped++;
          }
        }
        log.info(`Session migration complete: ${migrated} migrated, ${skipped} skipped`);
      },
    },
    { version: 16, name: "create_agent_skill_assignments", sql: `CREATE TABLE IF NOT EXISTS agent_skill_assignments (agent_id TEXT NOT NULL, skill_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (agent_id, skill_id), FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE, FOREIGN KEY (skill_id) REFERENCES company_skills(id) ON DELETE CASCADE); CREATE INDEX IF NOT EXISTS idx_agent_skill_assignments_skill ON agent_skill_assignments(skill_id)` },
    {
      version: 17, name: "migrate_pending_wakes_to_wakeup_requests",
      fn: () => {
        const existingWakes = readAll<{ id: string; companyId: string; agentId: string; triggerReason: string; createdAt: string }>(
          `SELECT id, company_id AS companyId, agent_id AS agentId, trigger_reason AS triggerReason, created_at AS createdAt FROM pending_wakes`,
        );
        const ts = nowIso();
        for (const wake of existingWakes) {
          const triggerDetail = JSON.stringify([{ trigger: wake.triggerReason, at: wake.createdAt, detail: wake.triggerReason }]);
          db.prepare(`INSERT OR IGNORE INTO wakeup_requests (id, company_id, agent_id, source, trigger_detail, status, coalesced_count, requested_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?)`).run(wake.id, wake.companyId, wake.agentId, wake.triggerReason, triggerDetail, wake.createdAt, ts, ts);
        }
        db.exec("DROP TABLE IF EXISTS pending_wakes");
      },
    },
    {
      version: 18, name: "migrate_agent_budget_to_policies",
      fn: () => {
        const agents = readAll<{ id: string; companyId: string; budgetMonthlyUsd: number }>("SELECT id, company_id as companyId, budget_monthly_usd as budgetMonthlyUsd FROM agents WHERE budget_monthly_usd > 0");
        const ts = nowIso();
        for (const agent of agents) {
          const existing = db.prepare("SELECT id FROM budget_policies WHERE company_id = ? AND scope_type = 'agent' AND scope_id = ? AND metric = 'billed_cents' AND window_kind = 'calendar_month_utc'").get(agent.companyId, agent.id);
          if (!existing) {
            db.prepare("INSERT INTO budget_policies (id, company_id, scope_type, scope_id, metric, window_kind, amount, warn_percent, hard_stop_enabled, notify_enabled, is_active, created_at, updated_at) VALUES (?, ?, 'agent', ?, 'billed_cents', 'calendar_month_utc', ?, 80, 1, 1, 1, ?, ?)").run(randomUUID(), agent.companyId, agent.id, Math.round(agent.budgetMonthlyUsd * 100), ts, ts);
          }
        }
        log.info(`Budget migration: converted ${agents.length} agent budget(s) to policy rows`);
      },
    },
    {
      version: 19, name: "add_document_revisions_and_approval_comments",
      fn: () => {
        db.exec(`CREATE TABLE IF NOT EXISTS document_revisions (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, document_id TEXT NOT NULL, revision_number INTEGER NOT NULL, body TEXT NOT NULL, change_summary TEXT, created_by_agent_id TEXT, created_by_user_id TEXT, created_at TEXT NOT NULL, FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE); CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_rev_doc_num ON document_revisions(document_id, revision_number); CREATE INDEX IF NOT EXISTS idx_doc_rev_company ON document_revisions(company_id, document_id, created_at); CREATE TABLE IF NOT EXISTS approval_comments (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, approval_id TEXT NOT NULL, author_agent_id TEXT, author_user_id TEXT, body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (approval_id) REFERENCES approvals(id) ON DELETE CASCADE); CREATE INDEX IF NOT EXISTS idx_approval_comments_approval ON approval_comments(approval_id, created_at)`);
        if (!columnExists(db, "documents", "latest_revision_id")) {
          db.prepare("ALTER TABLE documents ADD COLUMN latest_revision_id TEXT").run();
        }
      },
    },
    {
      version: 20, name: "add_task_timestamps_and_task_approval_links",
      fn: () => {
        const addCol = (table: string, column: string, sql: string) => {
          if (!columnExists(db, table, column)) db.prepare(sql).run();
        };
        addCol("tasks", "started_at", "ALTER TABLE tasks ADD COLUMN started_at TEXT");
        addCol("tasks", "completed_at", "ALTER TABLE tasks ADD COLUMN completed_at TEXT");
        addCol("tasks", "cancelled_at", "ALTER TABLE tasks ADD COLUMN cancelled_at TEXT");
        db.exec(`CREATE TABLE IF NOT EXISTS task_approval_links (task_id TEXT NOT NULL, approval_id TEXT NOT NULL, company_id TEXT NOT NULL, linked_by_agent_id TEXT, created_at TEXT NOT NULL, PRIMARY KEY (task_id, approval_id), FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE, FOREIGN KEY (approval_id) REFERENCES approvals(id) ON DELETE CASCADE); CREATE INDEX IF NOT EXISTS idx_task_approval_links_task ON task_approval_links(task_id); CREATE INDEX IF NOT EXISTS idx_task_approval_links_approval ON task_approval_links(approval_id)`);
        db.prepare("UPDATE tasks SET started_at = updated_at WHERE started_at IS NULL AND status IN ('in_progress', 'in_review', 'done')").run();
        db.prepare("UPDATE tasks SET completed_at = updated_at WHERE completed_at IS NULL AND status = 'done'").run();
        db.prepare("UPDATE tasks SET cancelled_at = updated_at WHERE cancelled_at IS NULL AND status = 'cancelled'").run();
      },
    },
    {
      version: 21, name: "add_work_products_task_documents_wakeup_context",
      fn: () => {
        db.exec(`CREATE TABLE IF NOT EXISTS work_products (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, project_id TEXT, task_id TEXT NOT NULL, type TEXT NOT NULL, provider TEXT NOT NULL, external_id TEXT, title TEXT NOT NULL, url TEXT, status TEXT NOT NULL DEFAULT 'active', review_state TEXT NOT NULL DEFAULT 'none', is_primary INTEGER NOT NULL DEFAULT 0, summary TEXT, metadata_json TEXT, created_by_run_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE); CREATE INDEX IF NOT EXISTS idx_work_products_task ON work_products(company_id, task_id, type); CREATE INDEX IF NOT EXISTS idx_work_products_updated ON work_products(company_id, updated_at); CREATE TABLE IF NOT EXISTS task_documents (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, task_id TEXT NOT NULL, document_id TEXT NOT NULL, key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE, FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE); CREATE UNIQUE INDEX IF NOT EXISTS idx_task_documents_task_key ON task_documents(company_id, task_id, key); CREATE UNIQUE INDEX IF NOT EXISTS idx_task_documents_doc ON task_documents(document_id)`);
        if (!columnExists(db, "wakeup_requests", "context_snapshot")) {
          db.prepare("ALTER TABLE wakeup_requests ADD COLUMN context_snapshot TEXT").run();
        }
      },
    },
    {
      version: 22, name: "add_config_revisions_run_events_agent_permissions",
      fn: () => {
        db.exec(`CREATE TABLE IF NOT EXISTS agent_config_revisions (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, agent_id TEXT NOT NULL, revision_number INTEGER NOT NULL, changed_keys TEXT NOT NULL DEFAULT '[]', config_before TEXT NOT NULL, config_after TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'patch', rolled_back_from_revision_id TEXT, created_by_agent_id TEXT, created_by_user_id TEXT, created_at TEXT NOT NULL, FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE); CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_config_rev_num ON agent_config_revisions(agent_id, revision_number); CREATE INDEX IF NOT EXISTS idx_agent_config_rev_agent ON agent_config_revisions(company_id, agent_id, created_at); CREATE TABLE IF NOT EXISTS run_events (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id TEXT NOT NULL, run_id TEXT NOT NULL, agent_id TEXT NOT NULL, seq INTEGER NOT NULL, event_type TEXT NOT NULL, stream TEXT, level TEXT, message TEXT, payload TEXT, created_at TEXT NOT NULL, FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE); CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id, seq); CREATE INDEX IF NOT EXISTS idx_run_events_company ON run_events(company_id, run_id)`);
        const addCol = (table: string, column: string, sql: string) => {
          if (!columnExists(db, table, column)) db.prepare(sql).run();
        };
        addCol("agents", "permissions_json", "ALTER TABLE agents ADD COLUMN permissions_json TEXT NOT NULL DEFAULT '{}'");
        addCol("agents", "heartbeat_policy_json", "ALTER TABLE agents ADD COLUMN heartbeat_policy_json TEXT");
        addCol("agents", "runtime_state_json", "ALTER TABLE agents ADD COLUMN runtime_state_json TEXT");
        addCol("runs", "context_snapshot_json", "ALTER TABLE runs ADD COLUMN context_snapshot_json TEXT");
        addCol("runs", "actor_type", "ALTER TABLE runs ADD COLUMN actor_type TEXT");
        addCol("runs", "actor_id", "ALTER TABLE runs ADD COLUMN actor_id TEXT");
      },
    },
    {
      version: 23, name: "create_thread_runtime_tables",
      fn: () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS conversation_threads (
            id TEXT PRIMARY KEY,
            company_id TEXT NOT NULL,
            title TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'task',
            related_entity_type TEXT,
            related_entity_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_conv_threads_company ON conversation_threads(company_id);
          CREATE INDEX IF NOT EXISTS idx_conv_threads_entity ON conversation_threads(related_entity_type, related_entity_id);

          CREATE TABLE IF NOT EXISTS conversation_events (
            id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
            actor_id TEXT NOT NULL,
            actor_type TEXT NOT NULL,
            event_type TEXT NOT NULL,
            body TEXT NOT NULL,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_conv_events_thread ON conversation_events(thread_id, created_at);

          CREATE TABLE IF NOT EXISTS thread_wait_states (
            id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
            company_id TEXT NOT NULL,
            waiting_for TEXT NOT NULL,
            related_approval_id TEXT,
            reason TEXT NOT NULL,
            created_at TEXT NOT NULL,
            resolved_at TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_thread_wait_company ON thread_wait_states(company_id, resolved_at);
          CREATE INDEX IF NOT EXISTS idx_thread_wait_thread ON thread_wait_states(thread_id);

          CREATE TABLE IF NOT EXISTS conversation_participants (
            thread_id TEXT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
            participant_id TEXT NOT NULL,
            participant_type TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'member',
            joined_at TEXT NOT NULL,
            PRIMARY KEY (thread_id, participant_id)
          );
          CREATE INDEX IF NOT EXISTS idx_conv_participants_participant ON conversation_participants(participant_id);
        `);
      },
    },
    {
      version: 24, name: "create_thread_subscriptions",
      sql: `CREATE TABLE IF NOT EXISTS thread_subscriptions (
    thread_id TEXT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
    subscriber_id TEXT NOT NULL,
    subscriber_type TEXT NOT NULL,
    notify_on TEXT NOT NULL DEFAULT 'all',
    subscribed_at TEXT NOT NULL,
    PRIMARY KEY (thread_id, subscriber_id)
  );
  CREATE INDEX IF NOT EXISTS idx_thread_subs_subscriber ON thread_subscriptions(subscriber_id)`,
    },
    {
      version: 25, name: "add_sender_kind_to_messages",
      sql: `ALTER TABLE agent_messages ADD COLUMN sender_kind TEXT NOT NULL DEFAULT 'agent'`,
    },
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
  ];

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    try {
      transaction(() => {
        if (migration.fn) {
          migration.fn();
        } else if (migration.sql) {
          for (const stmt of migration.sql.split(";").map((s) => s.trim()).filter(Boolean)) {
            db.prepare(stmt).run();
          }
        }
        db.prepare("insert into schema_migrations (version, name, applied_at) values (?, ?, ?)").run(migration.version, migration.name, nowIso());
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Migration ${migration.version} (${migration.name}) failed: ${message}`);
    }
  }
}
