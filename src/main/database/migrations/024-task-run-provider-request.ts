export const taskRunProviderRequestSchema = `
  alter table task_runs add column provider_request_id text references provider_requests(id) on delete set null;

  create index if not exists idx_task_runs_provider_request
    on task_runs(provider_request_id)
    where provider_request_id is not null;

  insert into schema_migrations(version, name, applied_at)
  values (24, 'task_run_provider_request', datetime('now'));
`;
