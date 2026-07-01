export const composioIntegrationSchema = `
  create table if not exists composio_settings (
    org_id text not null references organizations(id) on delete cascade,
    key text not null,
    value text not null,
    updated_at text not null,
    primary key (org_id, key)
  );
`;
