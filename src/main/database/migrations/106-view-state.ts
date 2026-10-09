// Where the operator was (page, section, filters, selected records), so switching away or restarting returns there.
export const viewStateSchema = `
  alter table app_state add column view_state_json text;

  insert into schema_migrations(version, name, applied_at)
  values (106, 'view_state', datetime('now'));
`;
