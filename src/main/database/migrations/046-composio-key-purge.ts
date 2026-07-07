/**
 * The Composio API key used to be seeded into composio_settings per
 * organization — including a revoked hardcoded key that kept resurfacing.
 * The key now ships embedded in the main-process bundle and is never
 * persisted, so stored copies (and the never-read toolkits rows) are purged.
 * entity_id and auth_config:* rows stay: connections still use them.
 */
export const composioKeyPurgeSchema = `
  delete from composio_settings where key in ('api_key', 'toolkits');
`;
