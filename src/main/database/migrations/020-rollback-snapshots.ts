export const rollbackSnapshotsSchema = `
  create table if not exists rollback_snapshots (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    migration_report_id text not null references migration_reports(id) on delete cascade,
    source_database_path text not null,
    source_fingerprint text not null,
    source_database_sha256 text not null,
    workspace_manifest_json text not null,
    workspace_manifest_sha256 text not null,
    delta_journal_json text not null,
    restore_plan_json text not null,
    active integer not null,
    created_by_employee_id text references employees(id) on delete set null,
    created_at text not null,
    activated_at text
  );

  create index if not exists idx_rollback_snapshots_org_created on rollback_snapshots(org_id, created_at);
  create index if not exists idx_rollback_snapshots_report on rollback_snapshots(migration_report_id);
  create unique index if not exists idx_rollback_snapshots_one_active on rollback_snapshots(org_id) where active = 1;

  insert into schema_migrations(version, name, applied_at)
  values (20, 'rollback_snapshots', datetime('now'));
`;
