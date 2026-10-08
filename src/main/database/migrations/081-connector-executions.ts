export const connectorExecutionsSchema = `
  create table if not exists connector_executions (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    agent_id text not null,
    run_id text,
    action text not null,
    arguments_hash text not null,
    state text not null check (state in ('pending', 'succeeded', 'failed', 'unknown', 'resolved')),
    detail text,
    created_at text not null,
    updated_at text not null
  );
  create index if not exists connector_executions_call on connector_executions(org_id, action, arguments_hash, state);

  insert into schema_migrations(version, name, applied_at)
  values (81, 'connector_executions', datetime('now'));
`;
