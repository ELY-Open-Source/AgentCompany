// Google Antigravity is no longer offered; its rows, secrets and key go.
export const dropGoogleAntigravitySchema = `
  update agents set model_provider_id = null, model_id = null
  where model_provider_id in (select id from providers where provider_key = 'google-antigravity');
  update organizations set audit_provider_id = null
  where audit_provider_id in (select id from providers where provider_key = 'google-antigravity');
  delete from providers where provider_key = 'google-antigravity';
  update credentials set ciphertext = x'' where provider_key = 'google-antigravity';
  delete from integration_keys where name = 'google_antigravity_client_secret';
  update app_state
  set onboarding_draft_json = json_set(onboarding_draft_json, '$.step', 'provider', '$.providerKey', 'openai', '$.providerModel', 'gpt-6.1-sol', '$.providerBaseUrl', '')
  where json_extract(onboarding_draft_json, '$.providerKey') = 'google-antigravity';
`;
