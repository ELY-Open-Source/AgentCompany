export const runCapabilityWarningsSchema = `
  alter table task_runs add column capability_warnings text;

  insert into schema_migrations(version, name, applied_at)
  values (80, 'run_capability_warnings', datetime('now'));
`;
