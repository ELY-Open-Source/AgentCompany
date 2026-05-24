export const migrationCutoverJournalSchema = `
  create table if not exists migration_cutover_events (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    migration_report_id text not null references migration_reports(id) on delete cascade,
    rollback_snapshot_id text references rollback_snapshots(id) on delete set null,
    event_type text not null,
    actor_type text not null,
    actor_id text,
    payload_json text not null,
    created_at text not null
  );

  create table if not exists migration_reconciliation_items (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    migration_report_id text not null references migration_reports(id) on delete cascade,
    rollback_snapshot_id text references rollback_snapshots(id) on delete set null,
    source_event_id text not null,
    target_type text not null,
    target_id text not null,
    reason text not null,
    state text not null,
    payload_json text not null,
    created_at text not null,
    resolved_at text,
    resolved_by_employee_id text references employees(id) on delete set null,
    unique(rollback_snapshot_id, source_event_id)
  );

  insert into migration_cutover_events(
    id, org_id, migration_report_id, rollback_snapshot_id, event_type,
    actor_type, actor_id, payload_json, created_at
  )
  select
    'mce_' || lower(hex(randomblob(16))),
    org_id,
    migration_report_id,
    id,
    case active when 1 then 'rollback_snapshot_activated' else 'rollback_snapshot_created' end,
    'system',
    null,
    json_object('sourceFingerprint', source_fingerprint, 'sourceDatabaseSha256', source_database_sha256),
    created_at
  from rollback_snapshots
  where not exists (
    select 1 from migration_cutover_events
    where migration_cutover_events.rollback_snapshot_id = rollback_snapshots.id
  );

  create index if not exists idx_migration_cutover_events_org_created
    on migration_cutover_events(org_id, created_at);
  create index if not exists idx_migration_cutover_events_report
    on migration_cutover_events(migration_report_id, created_at);
  create index if not exists idx_migration_reconciliation_items_org_state
    on migration_reconciliation_items(org_id, state, created_at);
  create index if not exists idx_migration_reconciliation_items_report
    on migration_reconciliation_items(migration_report_id, created_at);

  insert into schema_migrations(version, name, applied_at)
  values (28, 'migration_cutover_journal', datetime('now'));
`;
