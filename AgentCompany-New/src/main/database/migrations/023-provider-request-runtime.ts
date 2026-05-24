export const providerRequestRuntimeSchema = `
  alter table provider_requests add column external_response_id text;
  alter table provider_requests add column stream_event_count integer not null default 0;
  alter table provider_requests add column cancelled_at text;

  create index if not exists idx_provider_requests_external_response
    on provider_requests(provider_id, external_response_id)
    where external_response_id is not null;

  insert into schema_migrations(version, name, applied_at)
  values (23, 'provider_request_runtime', datetime('now'));
`;
