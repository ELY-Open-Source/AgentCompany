export const taskHandoffSchema = `
  alter table tasks add column handoff_json text;

  insert into schema_migrations(version, name, applied_at)
  values (59, 'task_handoff', datetime('now'));
`;
