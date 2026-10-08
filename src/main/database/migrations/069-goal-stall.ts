export const goalStallSchema = `
  alter table goals add column stalled_reason text;

  insert into schema_migrations(version, name, applied_at)
  values (69, 'goal_stall', datetime('now'));
`;
