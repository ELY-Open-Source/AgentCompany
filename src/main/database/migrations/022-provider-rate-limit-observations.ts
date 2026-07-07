export const providerRateLimitObservationSchema = `
  create table if not exists provider_rate_limit_observations (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    provider_id text not null references providers(id) on delete cascade,
    provider_key text not null,
    model text,
    request_limit integer,
    remaining_requests integer,
    reset_at text,
    retry_after_ms integer,
    raw_state_json text not null,
    observed_at text not null
  );

  create index if not exists idx_provider_rate_limit_observations_org_provider
    on provider_rate_limit_observations(org_id, provider_id, observed_at desc);

  insert into schema_migrations(version, name, applied_at)
  values (22, 'provider_rate_limit_observations', datetime('now'));
`;
