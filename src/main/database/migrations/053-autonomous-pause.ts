export const autonomousPauseSchema = `
  alter table app_state add column autorun_paused integer not null default 0;

  insert into schema_migrations(version, name, applied_at)
  values (53, 'autonomous_pause', datetime('now'));
`;
