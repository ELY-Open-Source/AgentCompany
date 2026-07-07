/**
 * Auth configs are configured in the Composio dashboard and mirrored through
 * the API at runtime — the app no longer creates them, so the create-once
 * auth_config:* cache rows in composio_settings are never read again and are
 * purged. entity_id rows stay: connected-account calls still use them.
 */
export const authConfigPurgeSchema = `
  delete from composio_settings where key like 'auth_config:%';
`;
