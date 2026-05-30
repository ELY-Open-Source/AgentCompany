export const customProvidersSchema = `
  insert or ignore into providers(id, org_id, provider_key, label, auth_type, model, credential_id, enabled, created_at)
  select 'prv_' || lower(hex(randomblob(16))), organizations.id, 'custom-openai', 'Custom OpenAI-compatible', 'cloud', null, null, 0, datetime('now')
  from organizations;

  insert or ignore into providers(id, org_id, provider_key, label, auth_type, model, credential_id, enabled, created_at)
  select 'prv_' || lower(hex(randomblob(16))), organizations.id, 'custom-anthropic', 'Custom Anthropic-compatible', 'cloud', null, null, 0, datetime('now')
  from organizations;

  insert into schema_migrations(version, name, applied_at)
  values (37, 'custom_providers', datetime('now'));
`;
