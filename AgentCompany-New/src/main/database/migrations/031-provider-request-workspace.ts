export const providerRequestWorkspaceSchema = `
  alter table provider_requests add column workspace_id text references workspaces(id) on delete set null;

  create index if not exists idx_provider_requests_workspace
    on provider_requests(org_id, workspace_id, created_at)
    where workspace_id is not null;

  insert into schema_migrations(version, name, applied_at)
  values (31, 'provider_request_workspace', datetime('now'));
`;
