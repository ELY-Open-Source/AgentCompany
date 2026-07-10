export const kimiCodeProviderSchema = `
  insert or ignore into providers(id, org_id, provider_key, label, auth_type, model, credential_id, enabled, created_at)
  select 'prv_' || lower(hex(randomblob(16))), organizations.id, 'kimi-code', 'Kimi Code', 'oauth_pkce', 'kimi-for-coding', null, 0, datetime('now')
  from organizations;

  insert into schema_migrations(version, name, applied_at)
  values (57, 'kimi_code_provider', datetime('now'));
`;
