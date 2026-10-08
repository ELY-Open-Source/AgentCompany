export const connectorPendingAccountSchema = `
  alter table connector_accounts add column pending_account_id text;

  insert into schema_migrations(version, name, applied_at)
  values (82, 'connector_pending_account', datetime('now'));
`;
