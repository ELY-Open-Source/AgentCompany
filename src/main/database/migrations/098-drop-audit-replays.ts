// Thread "replays" only digested audit events and could not reconstruct a run's context, tool calls or outside state.
export const dropAuditReplaysSchema = `
  drop table if exists audit_replay_runs;

  insert into schema_migrations(version, name, applied_at)
  values (98, 'drop_audit_replays', datetime('now'));
`;
