export const taskRunContextSchema = `
  alter table task_runs add column context_json text;

  insert into schema_migrations(version, name, applied_at)
  values (61, 'task_run_context', datetime('now'));
`;
