export const connectorGrantLimitsSchema = `
  alter table agent_connector_grants add column allowed_actions text;
  alter table agent_connector_grants add column fixed_arguments text;

  insert into schema_migrations(version, name, applied_at)
  values (84, 'connector_grant_limits', datetime('now'));
`;
