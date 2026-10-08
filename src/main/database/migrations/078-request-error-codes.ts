export const requestErrorCodesSchema = `
  alter table provider_requests add column error_status integer;
  alter table provider_requests add column error_code text;

  insert into schema_migrations(version, name, applied_at)
  values (78, 'request_error_codes', datetime('now'));
`;
