export const providerContextWindowSchema = `
  alter table providers add column context_window_tokens integer not null default 128000;

  insert into schema_migrations(version, name, applied_at)
  values (62, 'provider_context_window', datetime('now'));
`;
