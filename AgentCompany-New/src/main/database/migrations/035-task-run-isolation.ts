export const taskRunIsolationSchema = `
  alter table task_runs add column execution_context_id text;
  alter table task_runs add column service_identity_id text references service_identities(id) on delete set null;
  alter table task_runs add column workspace_mount_json text not null default '[]';
  alter table task_runs add column secret_scope_json text not null default '{}';

  create unique index if not exists idx_task_runs_execution_context
    on task_runs(execution_context_id)
    where execution_context_id is not null;
  create index if not exists idx_task_runs_service_identity
    on task_runs(service_identity_id)
    where service_identity_id is not null;

  insert into schema_migrations(version, name, applied_at)
  values (35, 'task_run_isolation', datetime('now'));
`;
