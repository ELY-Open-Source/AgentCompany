// The browser-session SLO was fed only by the removed chaos drill, so no runtime signal could ever meet or miss it.
export const dropDrillOnlySloSchema = `
  delete from slo_targets where signal_key = 'browser_session_boundary';

  insert into schema_migrations(version, name, applied_at)
  values (97, 'drop_drill_only_slo', datetime('now'));
`;
