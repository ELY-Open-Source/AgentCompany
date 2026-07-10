export const kimiProvidersSchema = `
  insert or ignore into providers(id, org_id, provider_key, label, auth_type, model, credential_id, enabled, created_at)
  select 'prv_' || lower(hex(randomblob(16))), organizations.id, 'kimi', 'Kimi', 'api_key', 'kimi-k2.7-code', null, 0, datetime('now')
  from organizations;

  insert or ignore into providers(id, org_id, provider_key, label, auth_type, model, credential_id, enabled, created_at)
  select 'prv_' || lower(hex(randomblob(16))), organizations.id, 'kimi-cn', 'Kimi CN', 'api_key', 'kimi-k2.7-code', null, 0, datetime('now')
  from organizations;

  insert into schema_migrations(version, name, applied_at)
  values (56, 'kimi_providers', datetime('now'));
`;
