export const runPinsSchema = `
  alter table task_runs add column run_model text;
  alter table task_runs add column run_credential_id text;

  insert into schema_migrations(version, name, applied_at)
  values (76, 'run_pins', datetime('now'));
`;
