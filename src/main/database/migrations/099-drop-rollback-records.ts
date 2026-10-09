// Rollback snapshots, cutover events and reconciliation items only recorded states; nothing ever restored a database, file or outside action, so reports drop their restore promise too.
export const dropRollbackRecordsSchema = `
  drop table if exists migration_reconciliation_items;
  drop table if exists migration_cutover_events;
  drop table if exists rollback_snapshots;
  update migration_reports set report_json = json_remove(report_json, '$.rollbackPack');

  insert into schema_migrations(version, name, applied_at)
  values (99, 'drop_rollback_records', datetime('now'));
`;
