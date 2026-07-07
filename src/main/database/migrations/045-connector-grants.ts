export const connectorGrantsSchema = `
  create table if not exists connector_accounts (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    toolkit_slug text not null,
    toolkit_name text not null,
    auth_config_id text not null,
    status text not null,
    created_at text not null,
    updated_at text not null,
    unique (org_id, toolkit_slug)
  );

  create table if not exists agent_connector_grants (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    agent_id text not null references agents(id) on delete cascade,
    toolkit_slug text not null,
    granted_by_type text not null,
    granted_by_id text,
    created_at text not null,
    unique (org_id, agent_id, toolkit_slug)
  );

  create index if not exists idx_connector_grants_agent on agent_connector_grants(org_id, agent_id);
`;
