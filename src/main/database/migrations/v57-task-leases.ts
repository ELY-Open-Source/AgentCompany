import type { DatabaseSync } from "node:sqlite";
import { STALE_LOCK_TIMEOUT_MS } from "../../constants";
import { columnExists, nowIso, tableExists } from "./types";

export const TASK_LEASE_SCHEMA_VERSION = 57;
export const TASK_LEASE_SCHEMA_NAME = "task_leases_runtime_ownership";

const LEASE_SECONDS = Math.floor(STALE_LOCK_TIMEOUT_MS / 1000);

export function migrateTaskLeasesV57(db: DatabaseSync): void {
  installTaskLeasesTable(db);
  backfillTaskLeases(db);
  dropTaskOwnershipColumns(db);
  db
    .prepare("insert or replace into schema_migrations (version, name, applied_at) values (?, ?, ?)")
    .run(TASK_LEASE_SCHEMA_VERSION, TASK_LEASE_SCHEMA_NAME, nowIso());
  assertTaskLeasesV57(db);
}

export function assertTaskLeasesV57(db: DatabaseSync): void {
  if (!tableExists(db, "task_leases")) {
    throw new Error("Schema v57 drift: task_leases table is missing.");
  }
  if (!tableExists(db, "tasks")) {
    throw new Error("Schema v57 drift: tasks table is missing.");
  }

  const leaseColumns = db
    .prepare("pragma table_info(task_leases)")
    .all()
    .map((row) => row as { name: string; type: string; notnull: number; pk: number });
  const expectedLeaseColumns = [
    ["task_id", "TEXT", 0, 1],
    ["company_id", "TEXT", 1, 0],
    ["run_id", "TEXT", 1, 0],
    ["agent_id", "TEXT", 1, 0],
    ["acquired_at", "TEXT", 1, 0],
    ["renewed_at", "TEXT", 1, 0],
    ["expires_at", "TEXT", 1, 0],
    ["created_at", "TEXT", 1, 0],
    ["updated_at", "TEXT", 1, 0],
  ];
  const actualLeaseColumns = leaseColumns.map((column) => [
    column.name,
    column.type.toUpperCase(),
    column.notnull,
    column.pk,
  ]);
  if (JSON.stringify(actualLeaseColumns) !== JSON.stringify(expectedLeaseColumns)) {
    throw new Error("Schema v57 drift: task_leases columns do not match the canonical schema.");
  }

  const columns = new Set(
    db.prepare("pragma table_info(tasks)").all().map((row) => (row as { name: string }).name),
  );
  for (const column of ["active_run_id", "checkout_run_id", "execution_locked_at", "active_session_id"]) {
    if (columns.has(column)) {
      throw new Error(`Schema v57 drift: tasks.${column} should be stored in task_leases.`);
    }
  }
}

function installTaskLeasesTable(db: DatabaseSync): void {
  db.exec(`
    create table if not exists task_leases (
      task_id text primary key references tasks(id) on delete cascade,
      company_id text not null,
      run_id text not null unique references runs(id) on delete cascade,
      agent_id text not null references agents(id) on delete cascade,
      acquired_at text not null,
      renewed_at text not null,
      expires_at text not null,
      created_at text not null,
      updated_at text not null
    );
    create index if not exists idx_task_leases_company_agent on task_leases(company_id, agent_id);
    create index if not exists idx_task_leases_expires_at on task_leases(expires_at);
  `);
}

function backfillTaskLeases(db: DatabaseSync): void {
  if (!tableExists(db, "tasks") || !tableExists(db, "runs")) return;
  if (!columnExists(db, "tasks", "checkout_run_id") && !columnExists(db, "tasks", "active_run_id")) return;

  const runExpr = [
    columnExists(db, "tasks", "checkout_run_id") ? "t.checkout_run_id" : "NULL",
    columnExists(db, "tasks", "active_run_id") ? "t.active_run_id" : "NULL",
  ].join(", ");
  const lockExpr = columnExists(db, "tasks", "execution_locked_at")
    ? "coalesce(t.execution_locked_at, t.updated_at)"
    : "t.updated_at";
  const ts = nowIso();

  db.exec(`
    insert or ignore into task_leases (
      task_id, company_id, run_id, agent_id, acquired_at, renewed_at, expires_at, created_at, updated_at
    )
    select t.id,
           t.company_id,
           coalesce(${runExpr}) as run_id,
           r.agent_id,
           ${lockExpr} as acquired_at,
           ${lockExpr} as renewed_at,
           strftime('%Y-%m-%dT%H:%M:%fZ', ${lockExpr}, '+${LEASE_SECONDS} seconds') as expires_at,
           '${ts}' as created_at,
           '${ts}' as updated_at
    from tasks t
    join runs r on r.id = coalesce(${runExpr})
    where coalesce(${runExpr}) is not null
      and r.status in ('queued', 'running')
  `);
}

function dropTaskOwnershipColumns(db: DatabaseSync): void {
  if (!tableExists(db, "tasks")) return;
  for (const column of ["active_run_id", "checkout_run_id", "execution_locked_at", "active_session_id"]) {
    if (columnExists(db, "tasks", column)) {
      db.exec(`alter table tasks drop column ${column}`);
    }
  }
}
