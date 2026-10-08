export const backgroundPollFailuresSchema = `
  alter table provider_requests add column poll_failures integer not null default 0;
  alter table provider_requests add column last_poll_error text;

  insert into schema_migrations(version, name, applied_at)
  values (71, 'background_poll_failures', datetime('now'));
`;
