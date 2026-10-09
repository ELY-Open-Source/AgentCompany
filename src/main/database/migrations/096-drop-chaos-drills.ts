// Chaos drills scored configuration rows as fault handling and never injected a fault; their flag and the signals they wrote go with them.
export const dropChaosDrillsSchema = `
  drop table if exists chaos_drill_runs;
  drop table if exists chaos_drills;
  delete from feature_flags where key = 'chaos_drills';
  delete from operational_events where source = 'chaos_drill';

  insert into schema_migrations(version, name, applied_at)
  values (96, 'drop_chaos_drills', datetime('now'));
`;
