import type { DatabaseSync } from "node:sqlite";
import log from "electron-log/main.js";
import { createMigrationsV1V15 } from "./migrations/v1-v15";
import { createMigrationsV16V25 } from "./migrations/v16-v25";
import { createMigrationsV26V34 } from "./migrations/v26-v34";
import { createMigrationsV35V37 } from "./migrations/v35-v37";
import { createMigrationsV38V39 } from "./migrations/v38-v39";
import { createMigrationsV40V40 } from "./migrations/v40-v40";
import { createMigrationsV41V41 } from "./migrations/v41-v41";
import { createMigrationsV42V42 } from "./migrations/v42-v42";
import { createMigrationsV43V43 } from "./migrations/v43-v43";
import { createMigrationsV44V44 } from "./migrations/v44-v44";
import { createMigrationsV45V45 } from "./migrations/v45-v45";
import { createMigrationsV46V46 } from "./migrations/v46-v46";
import { createMigrationsV47V47 } from "./migrations/v47-v47";
import { createMigrationsV48V48 } from "./migrations/v48-v48";
import { createMigrationsV49V49 } from "./migrations/v49-v49";
import {
  columnExists,
  nowIso,
  tableExists,
  type Migration,
  type ReadAll,
  type Transaction,
} from "./migrations/types";

export function ensureOptionalColumns(db: DatabaseSync) {
  const addColumnIfMissing = (table: string, column: string, sql: string) => {
    if (!columnExists(db, table, column)) db.prepare(sql).run();
  };
  addColumnIfMissing("connectors", "updated_at", "alter table connectors add column updated_at text");
  addColumnIfMissing("approvals", "payload_json", "alter table approvals add column payload_json text");
  addColumnIfMissing("agents", "heartbeat_enabled", "alter table agents add column heartbeat_enabled integer not null default 0");
  addColumnIfMissing("agents", "heartbeat_interval_sec", "alter table agents add column heartbeat_interval_sec integer not null default 120");
  addColumnIfMissing("agents", "last_heartbeat_at", "alter table agents add column last_heartbeat_at text");
  addColumnIfMissing("agents", "session_id", "alter table agents add column session_id text");
  db.exec("create index if not exists idx_agents_session_id on agents(session_id)");
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
  // Legacy profiles predate the per-company secrets table. Rebind each
  // row to the current company; if neither `current_company_id` nor any
  // company row exists we refuse rather than attach secrets to a
  // synthetic zero UUID that references nothing — that would leak
  // ciphertext with no deletion path and no UI visibility.
  const currentCompany = db.prepare("select value from settings where key = 'current_company_id'").get() as { value: string } | undefined;
  const firstCompany = db.prepare("select id from companies order by created_at asc limit 1").get() as { id: string } | undefined;
  const fallbackCompanyId = currentCompany?.value ?? firstCompany?.id;
  if (!fallbackCompanyId) {
    throw new Error(
      "Cannot migrate legacy secrets table: no current_company_id is set and no company rows exist. Create a company before upgrading, or drop the legacy secrets table if the rows are stale.",
    );
  }
  db.exec(`
    alter table secrets rename to secrets_legacy;
    create table secrets (id text primary key, company_id text not null, name text not null, description text not null, backend text not null, ciphertext blob not null, updated_at text not null, created_at text not null, unique(company_id, name));
  `);
  db.prepare("insert into secrets (id, company_id, name, description, backend, ciphertext, updated_at, created_at) select id, ?, name, description, backend, ciphertext, updated_at, created_at from secrets_legacy").run(fallbackCompanyId);
  db.exec("drop table secrets_legacy;");
}

export function initializeDatabase(
  db: DatabaseSync,
  ra: ReadAll,
  tx: Transaction,
  createAutomaticBackup: (reason: string) => string,
): void {
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
  runMigrations(db, ra, tx, createAutomaticBackup);
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
  createAutomaticBackup: (reason: string) => string,
) {
  db.exec(`create table if not exists schema_migrations (version integer primary key, name text not null, applied_at text not null);`);
  const applied = new Set(readAll<{ version: number }>("select version from schema_migrations").map((row) => row.version));

  const deps = { db, readAll };
  const migrations: Migration[] = [
    ...createMigrationsV1V15(deps),
    ...createMigrationsV16V25(deps),
    ...createMigrationsV26V34(deps),
    ...createMigrationsV35V37(deps),
    ...createMigrationsV38V39(deps),
    ...createMigrationsV40V40(deps),
    ...createMigrationsV41V41(deps),
    ...createMigrationsV42V42(deps),
    ...createMigrationsV43V43(deps),
    ...createMigrationsV44V44(deps),
    ...createMigrationsV45V45(deps),
    ...createMigrationsV46V46(deps),
    ...createMigrationsV47V47(deps),
    ...createMigrationsV48V48(deps),
    ...createMigrationsV49V49(deps),
  ];

  // Pre-migration snapshot. If any migration is pending we take a full
  // profile snapshot before touching a single row. A migration crash
  // then yields a well-labelled recovery point instead of a half-
  // upgraded profile. The snapshot itself must succeed — failure here
  // aborts the run with the raw error so the caller can surface it to
  // the operator rather than silently upgrade in-place.
  const pending = migrations.filter((m) => !applied.has(m.version));
  if (pending.length > 0) {
    const highestTargetVersion = pending.reduce((max, m) => Math.max(max, m.version), 0);
    const path = createAutomaticBackup(`pre-migration-v${highestTargetVersion}`);
    log.info(`[schema] pre-migration snapshot for v${highestTargetVersion} at ${path}`);
  }

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
