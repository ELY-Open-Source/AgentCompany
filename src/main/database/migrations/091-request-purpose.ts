// Requests from before purposes were recorded stay 'unrecorded' rather than being guessed.
export const requestPurposeSchema = `
  alter table provider_requests add column purpose text not null default 'unrecorded';
  create index if not exists provider_requests_run on provider_requests(task_run_id);

  insert into schema_migrations(version, name, applied_at)
  values (91, 'request_purpose', datetime('now'));
`;
