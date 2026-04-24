import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  BASELINE_SCHEMA_NAME,
  BASELINE_SCHEMA_VERSION,
  BASELINE_TABLE_SQL,
  installCanonicalBaselineIndexes,
  installBaselineTables,
  normalizeSchemaSql,
  parseBaselineTableName,
} from "./baseline-v56";
import {
  columnExists,
  nowIso,
  tableExists,
  type ReadAll,
} from "./types";

type ColumnInfo = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

type LegacyDeps = {
  db: DatabaseSync;
  readAll: ReadAll;
};

const BASELINE_TABLE_NAMES = BASELINE_TABLE_SQL.map((sql) => parseTableName(sql));
const EXPECTED_DROPPED_COLUMNS: Readonly<Record<string, ReadonlySet<string>>> = {
  agent_messages: new Set(["read_at"]),
  company_skills: new Set(["markdown"]),
  runs: new Set(["context_snapshot_json", "session_display_id"]),
  tasks: new Set(["is_heartbeat", "phase", "session_display_id", "session_json"]),
  task_sessions: new Set(["session_display_id", "session_params_json", "task_id"]),
};

export function markBaselineSchema(db: DatabaseSync): void {
  db.prepare("delete from schema_migrations where version <> ?").run(BASELINE_SCHEMA_VERSION);
  db
    .prepare("insert or replace into schema_migrations (version, name, applied_at) values (?, ?, ?)")
    .run(BASELINE_SCHEMA_VERSION, BASELINE_SCHEMA_NAME, nowIso());
}

export function upgradeLegacyProfileToBaselineV56({ db, readAll }: LegacyDeps): void {
  installBaselineTables(db);
  migrateLegacySecrets(db);
  migratePendingWakes(db, readAll);
  migrateAgentBudgets(db, readAll);

  for (const tableName of BASELINE_TABLE_NAMES) {
    if (tableName === "schema_migrations") continue;
    if (tableName === "runs") {
      backfillRunsUsageStatus(db);
    }
    if (tableName === "tasks") {
      migrateTaskSessions(db, readAll);
      backfillRequiresFilesystem(db);
      removeSyntheticHeartbeatTasks(db);
    }
    if (tableName === "work_products") {
      detachDanglingWorkProducts(db);
      backfillWorkProductProvenance(db);
      normalizeWorkProductPrimaries(db);
    }
    rebuildTableToBaseline(db, tableName);
  }

  db.exec("drop table if exists pending_wakes");
  db.exec("drop table if exists task_leases");
  db.exec("drop trigger if exists trg_tasks_phase_from_status_insert");
  db.exec("drop trigger if exists trg_tasks_phase_from_status_update");
  installCanonicalBaselineIndexes(db);
  assertNoForeignKeyViolations(db);
  markBaselineSchema(db);
}

function parseTableName(sql: string): string {
  return parseBaselineTableName(sql);
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll("\"", "\"\"")}"`;
}

function tableSql(tableName: string): string {
  const sql = BASELINE_TABLE_SQL.find((entry) => parseTableName(entry) === tableName);
  if (!sql) throw new Error(`Missing baseline SQL for table ${tableName}`);
  return sql;
}

function tableColumns(db: DatabaseSync, tableName: string): ColumnInfo[] {
  return db.prepare(`pragma table_info(${quoteIdentifier(tableName)})`).all() as ColumnInfo[];
}

function createSqlForTable(sql: string, tableName: string): string {
  return sql.replace(/^CREATE TABLE (?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)/, `CREATE TABLE ${quoteIdentifier(tableName)}`);
}

function rebuildTableToBaseline(db: DatabaseSync, tableName: string): void {
  if (!tableExists(db, tableName)) return;
  if (isBaselineTableDefinition(db, tableName)) return;

  const tempTableName = `__baseline_${tableName}_${process.pid}`;
  db.exec(`drop table if exists ${quoteIdentifier(tempTableName)}`);
  db.exec(createSqlForTable(tableSql(tableName), tempTableName));

  const beforeCount = (db.prepare(`select count(*) as count from ${quoteIdentifier(tableName)}`).get() as { count: number }).count;
  const sourceColumns = new Set(tableColumns(db, tableName).map((column) => column.name));
  const targetColumns = tableColumns(db, tempTableName);
  assertDroppedColumnsAreExpected(tableName, sourceColumns, new Set(targetColumns.map((column) => column.name)));
  const insertColumns = targetColumns.map((column) => quoteIdentifier(column.name));
  const selectExpressions = targetColumns.map((column) => {
    if (sourceColumns.has(column.name)) return quoteIdentifier(column.name);
    if (column.dflt_value !== null) return column.dflt_value;
    if (column.notnull === 0) return "NULL";
    if (beforeCount === 0) return "NULL";
    throw new Error(`Cannot rebuild ${tableName}: missing required column ${column.name}`);
  });

  db.exec(`insert into ${quoteIdentifier(tempTableName)} (${insertColumns.join(", ")}) select ${selectExpressions.join(", ")} from ${quoteIdentifier(tableName)}`);
  const afterCount = (db.prepare(`select count(*) as count from ${quoteIdentifier(tempTableName)}`).get() as { count: number }).count;
  if (afterCount !== beforeCount) {
    throw new Error(`Cannot rebuild ${tableName}: copied ${afterCount} of ${beforeCount} rows`);
  }

  db.exec(`drop table ${quoteIdentifier(tableName)}`);
  db.exec(`alter table ${quoteIdentifier(tempTableName)} rename to ${quoteIdentifier(tableName)}`);
}

function isBaselineTableDefinition(db: DatabaseSync, tableName: string): boolean {
  const row = db
    .prepare("select sql from sqlite_master where type = 'table' and name = ?")
    .get(tableName) as { sql: string | null } | undefined;
  if (!row?.sql) return false;
  return normalizeSchemaSql(row.sql) === normalizeSchemaSql(tableSql(tableName));
}

function assertDroppedColumnsAreExpected(tableName: string, sourceColumns: Set<string>, targetColumns: Set<string>): void {
  const allowed = EXPECTED_DROPPED_COLUMNS[tableName] ?? new Set<string>();
  const unexpected = [...sourceColumns]
    .filter((column) => !targetColumns.has(column))
    .filter((column) => !allowed.has(column));
  if (unexpected.length > 0) {
    throw new Error(`Cannot rebuild ${tableName}: unexpected legacy columns would be dropped: ${unexpected.join(", ")}`);
  }
}

function migrateLegacySecrets(db: DatabaseSync): void {
  if (!tableExists(db, "secrets") || columnExists(db, "secrets", "company_id")) return;

  const currentCompany = db.prepare("select value from settings where key = 'current_company_id'").get() as { value: string } | undefined;
  const firstCompany = db.prepare("select id from companies order by created_at asc limit 1").get() as { id: string } | undefined;
  const companyId = currentCompany?.value ?? firstCompany?.id;
  if (!companyId) {
    throw new Error("Cannot migrate legacy secrets table: no company row exists.");
  }

  db.exec(`
    alter table secrets rename to secrets_legacy;
    create table secrets (id text primary key, company_id text not null, name text not null, description text not null, backend text not null, ciphertext blob not null, updated_at text not null, created_at text not null, unique(company_id, name));
  `);
  db
    .prepare("insert into secrets (id, company_id, name, description, backend, ciphertext, updated_at, created_at) select id, ?, name, description, backend, ciphertext, updated_at, created_at from secrets_legacy")
    .run(companyId);
  db.exec("drop table secrets_legacy");
}

function migratePendingWakes(db: DatabaseSync, readAll: ReadAll): void {
  if (!tableExists(db, "pending_wakes")) return;
  const rows = readAll<{ id: string; companyId: string; agentId: string; triggerReason: string; createdAt: string }>(
    "select id, company_id as companyId, agent_id as agentId, trigger_reason as triggerReason, created_at as createdAt from pending_wakes",
  );
  const insert = db.prepare(`
    insert or ignore into wakeup_requests (id, company_id, agent_id, source, trigger_detail, status, coalesced_count, requested_at, created_at, updated_at)
    values (?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?)
  `);
  const ts = nowIso();
  for (const row of rows) {
    const detail = JSON.stringify([{ trigger: row.triggerReason, at: row.createdAt, detail: row.triggerReason }]);
    insert.run(row.id, row.companyId, row.agentId, row.triggerReason, detail, row.createdAt, ts, ts);
  }
}

function migrateAgentBudgets(db: DatabaseSync, readAll: ReadAll): void {
  if (!tableExists(db, "agents") || !tableExists(db, "budget_policies")) return;
  if (!columnExists(db, "agents", "budget_monthly_usd")) return;
  const agents = readAll<{ id: string; companyId: string; budgetMonthlyUsd: number }>(
    "select id, company_id as companyId, budget_monthly_usd as budgetMonthlyUsd from agents where budget_monthly_usd > 0",
  );
  const existing = db.prepare("select id from budget_policies where company_id = ? and scope_type = 'agent' and scope_id = ? and metric = 'billed_cents' and window_kind = 'calendar_month_utc'");
  const insert = db.prepare(`
    insert into budget_policies (id, company_id, scope_type, scope_id, metric, window_kind, amount, warn_percent, hard_stop_enabled, notify_enabled, is_active, created_at, updated_at)
    values (?, ?, 'agent', ?, 'billed_cents', 'calendar_month_utc', ?, 80, 1, 1, 1, ?, ?)
  `);
  const ts = nowIso();
  for (const agent of agents) {
    if (existing.get(agent.companyId, agent.id)) continue;
    insert.run(randomUUID(), agent.companyId, agent.id, Math.round(agent.budgetMonthlyUsd * 100), ts, ts);
  }
}

function migrateTaskSessions(db: DatabaseSync, readAll: ReadAll): void {
  if (!tableExists(db, "tasks") || !columnExists(db, "tasks", "session_json")) return;
  if (!columnExists(db, "tasks", "active_session_id")) {
    db.exec("alter table tasks add column active_session_id text");
  }

  const rows = readAll<{
    id: string;
    companyId: string;
    assigneeAgentId: string | null;
    sessionJson: string;
    sessionDisplayId: string | null;
    updatedAt: string;
    connectorId: string | null;
  }>(`
    select t.id,
           t.company_id as companyId,
           t.assignee_agent_id as assigneeAgentId,
           t.session_json as sessionJson,
           ${columnExists(db, "tasks", "session_display_id") ? "t.session_display_id" : "NULL"} as sessionDisplayId,
           t.updated_at as updatedAt,
           a.connector_id as connectorId
    from tasks t
    left join agents a on a.id = t.assignee_agent_id
    where t.session_json is not null
      and (t.active_session_id is null or t.active_session_id = '')
  `);
  const sessionColumns = new Set(tableColumns(db, "task_sessions").map((column) => column.name));
  const updateTask = db.prepare("update tasks set active_session_id = ? where id = ?");
  const existingSessionByTask = sessionColumns.has("task_id")
    ? db.prepare("select id from task_sessions where task_id = ? order by updated_at desc limit 1")
    : null;
  const insertColumns = [
    "id",
    "company_id",
    "agent_id",
    "adapter_type",
    "created_at",
    "updated_at",
    ...(sessionColumns.has("task_id") ? ["task_id"] : []),
    ...(sessionColumns.has("session_params_json") ? ["session_params_json"] : []),
    ...(sessionColumns.has("session_display_id") ? ["session_display_id"] : []),
  ];
  const insert = db.prepare(`
    insert into task_sessions (${insertColumns.map(quoteIdentifier).join(", ")})
    values (${insertColumns.map(() => "?").join(", ")})
  `);
  for (const row of rows) {
    JSON.parse(row.sessionJson);
    const existingSession = existingSessionByTask?.get(row.id) as { id: string } | undefined;
    if (existingSession) {
      updateTask.run(existingSession.id, row.id);
      continue;
    }
    if (!row.assigneeAgentId) {
      throw new Error(`Cannot migrate task session for task ${row.id}: assignee_agent_id is missing.`);
    }
    if (!row.connectorId) {
      throw new Error(`Cannot migrate task session for task ${row.id}: assigned agent connector_id is missing.`);
    }
    const sessionId = randomUUID();
    const values = [
      sessionId,
      row.companyId,
      row.assigneeAgentId,
      row.connectorId,
      row.updatedAt,
      row.updatedAt,
      ...(sessionColumns.has("task_id") ? [row.id] : []),
      ...(sessionColumns.has("session_params_json") ? [row.sessionJson] : []),
      ...(sessionColumns.has("session_display_id") ? [row.sessionDisplayId] : []),
    ];
    insert.run(...values);
    updateTask.run(sessionId, row.id);
  }
}

function backfillRequiresFilesystem(db: DatabaseSync): void {
  if (!tableExists(db, "tasks")) return;
  if (!columnExists(db, "tasks", "requires_filesystem")) {
    db.exec("alter table tasks add column requires_filesystem integer not null default 0");
  }
  if (columnExists(db, "tasks", "active_run_id")) {
    db.exec(`
      update tasks
      set requires_filesystem = 1
      where status = 'in_progress'
        and active_run_id is not null
    `);
  }
  if (columnExists(db, "tasks", "assignee_agent_id")) {
    db.exec(`
      update tasks
      set requires_filesystem = 1
      where status in ('todo', 'backlog')
        and assignee_agent_id is not null
        and exists (
          select 1 from agents a
          where a.id = tasks.assignee_agent_id
            and (
                 a.role like '%cto%'
              or a.role like '%engineer%'
              or a.role like '%developer%'
              or a.role like '%devops%'
              or a.role like '%sre%'
              or a.department = 'engineering'
            )
        )
    `);
  }
}

function removeSyntheticHeartbeatTasks(db: DatabaseSync): void {
  if (!tableExists(db, "tasks") || !columnExists(db, "tasks", "is_heartbeat")) return;
  if (tableExists(db, "runs")) {
    db.exec("update runs set task_id = null where task_id in (select id from tasks where is_heartbeat = 1)");
  }
  db.exec("delete from tasks where is_heartbeat = 1");
}

function backfillRunsUsageStatus(db: DatabaseSync): void {
  if (!tableExists(db, "runs")) return;
  if (!columnExists(db, "runs", "usage_status")) {
    db.exec("alter table runs add column usage_status text not null default 'pre_first_message'");
  }
  if (!columnExists(db, "runs", "unattributed_cost") || !columnExists(db, "runs", "status")) return;
  db.exec(`
    update runs
    set usage_status = case
      when unattributed_cost = 0 then 'ok'
      when status in ('cancelled', 'interrupted') then 'aborted_before_usage'
      else 'pre_first_message'
    end
    where usage_status = 'pre_first_message'
  `);
}

function normalizeWorkProductPrimaries(db: DatabaseSync): void {
  if (!tableExists(db, "work_products")) return;
  db.exec(`
    update work_products
    set is_primary = 0,
        updated_at = datetime('now')
    where id in (
      select id from (
        select id,
               row_number() over (
                 partition by company_id, task_id, type
                 order by updated_at desc, created_at desc, id desc
               ) as rank_in_group
        from work_products
        where task_id is not null
          and is_primary = 1
          and status <> 'archived'
      )
      where rank_in_group > 1
    )
  `);
}

function backfillWorkProductProvenance(db: DatabaseSync): void {
  if (!tableExists(db, "work_products")) return;
  if (!columnExists(db, "work_products", "workspace_id")) {
    db.exec("alter table work_products add column workspace_id text");
  }
  if (!columnExists(db, "work_products", "last_touched_by_run_id")) {
    db.exec("alter table work_products add column last_touched_by_run_id text");
  }
  if (tableExists(db, "tasks") && columnExists(db, "work_products", "task_id") && columnExists(db, "tasks", "workspace_id")) {
    db.exec(`
      update work_products
      set workspace_id = (
        select tasks.workspace_id from tasks
        where tasks.id = work_products.task_id
      )
      where workspace_id is null
        and task_id is not null
    `);
  }
  if (tableExists(db, "runs") && columnExists(db, "work_products", "created_by_run_id") && columnExists(db, "runs", "workspace_id")) {
    db.exec(`
      update work_products
      set workspace_id = (
        select runs.workspace_id from runs
        where runs.id = work_products.created_by_run_id
      )
      where workspace_id is null
        and created_by_run_id is not null
    `);
  }
  if (columnExists(db, "work_products", "created_by_run_id")) {
    db.exec(`
      update work_products
      set last_touched_by_run_id = created_by_run_id
      where last_touched_by_run_id is null
        and created_by_run_id is not null
    `);
  }
}

function detachDanglingWorkProducts(db: DatabaseSync): void {
  if (!tableExists(db, "work_products") || !tableExists(db, "tasks") || !columnExists(db, "work_products", "task_id")) return;
  db.exec(`
    update work_products
    set task_id = null
    where task_id is not null
      and not exists (
        select 1 from tasks
        where tasks.id = work_products.task_id
      )
  `);
}

function assertNoForeignKeyViolations(db: DatabaseSync): void {
  const violations = db.prepare("pragma foreign_key_check").all() as Array<{
    table: string;
    rowid: number | null;
    parent: string;
    fkid: number;
  }>;
  if (violations.length === 0) return;

  const sample = violations
    .slice(0, 5)
    .map((row) => `${row.table}:${row.rowid ?? "unknown"}->${row.parent}#${row.fkid}`)
    .join(", ");
  throw new Error(`Cannot migrate legacy profile: ${violations.length} foreign key violations after v56 rebuild (${sample}).`);
}
