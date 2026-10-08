export const connectorAccountLabelsSchema = `
  create table connector_accounts_next (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    toolkit_slug text not null,
    toolkit_name text not null,
    label text not null,
    auth_config_id text not null,
    status text not null,
    pending_account_id text,
    created_at text not null,
    updated_at text not null,
    unique (org_id, toolkit_slug, label)
  );
  insert into connector_accounts_next(id, org_id, toolkit_slug, toolkit_name, label, auth_config_id, status, pending_account_id, created_at, updated_at)
    select id, org_id, toolkit_slug, toolkit_name, 'main', auth_config_id, status, pending_account_id, created_at, updated_at from connector_accounts;
  drop table connector_accounts;
  alter table connector_accounts_next rename to connector_accounts;

  alter table agent_connector_grants add column account_label text not null default 'main';
  alter table connector_executions add column account_label text not null default 'main';

  insert into schema_migrations(version, name, applied_at)
  values (83, 'connector_account_labels', datetime('now'));
`;
