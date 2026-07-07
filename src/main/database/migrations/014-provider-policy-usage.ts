export const providerPolicyUsageSchema = `
  alter table providers add column data_policy text not null default 'standard';
  alter table providers add column background_enabled integer not null default 0;
  alter table providers add column monthly_request_limit integer not null default 1000;
  alter table providers add column workspace_scope text not null default 'organization';

  alter table provider_requests add column input_char_count integer not null default 0;
  alter table provider_requests add column output_char_count integer not null default 0;
  alter table provider_requests add column execution_mode text not null default 'foreground';
  alter table provider_requests add column policy_decision text not null default 'allowed:standard';

  create table if not exists provider_usage_windows (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    provider_id text not null references providers(id) on delete cascade,
    window_start text not null,
    window_end text not null,
    request_count integer not null,
    input_char_count integer not null,
    output_char_count integer not null,
    created_at text not null,
    updated_at text not null,
    unique(provider_id, window_start)
  );

  create index if not exists idx_provider_usage_windows_org_start
    on provider_usage_windows(org_id, window_start);

  insert into schema_migrations(version, name, applied_at)
  values (14, 'provider_policy_usage', datetime('now'));
`;
