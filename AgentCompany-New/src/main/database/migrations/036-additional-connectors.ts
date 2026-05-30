export const additionalConnectorsSchema = `
  insert or ignore into providers(id, org_id, provider_key, label, auth_type, model, credential_id, enabled, created_at)
  select 'prv_' || lower(hex(randomblob(16))), organizations.id, 'claude-pro', 'Claude Pro/Max', 'oauth_pkce', 'claude-sonnet-4-5', null, 0, datetime('now')
  from organizations;

  insert or ignore into providers(id, org_id, provider_key, label, auth_type, model, credential_id, enabled, created_at)
  select 'prv_' || lower(hex(randomblob(16))), organizations.id, 'mistral', 'Mistral', 'api_key', 'mistral-large-latest', null, 0, datetime('now')
  from organizations;

  insert or ignore into providers(id, org_id, provider_key, label, auth_type, model, credential_id, enabled, created_at)
  select 'prv_' || lower(hex(randomblob(16))), organizations.id, 'cerebras', 'Cerebras', 'api_key', 'qwen-3-235b-a22b-instruct-2507', null, 0, datetime('now')
  from organizations;

  insert or ignore into providers(id, org_id, provider_key, label, auth_type, model, credential_id, enabled, created_at)
  select 'prv_' || lower(hex(randomblob(16))), organizations.id, 'openrouter', 'OpenRouter', 'api_key', 'anthropic/claude-sonnet-4.5', null, 0, datetime('now')
  from organizations;

  insert into schema_migrations(version, name, applied_at)
  values (36, 'additional_connectors', datetime('now'));
`;
