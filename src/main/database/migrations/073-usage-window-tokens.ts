export const usageWindowTokensSchema = `
  alter table provider_usage_windows add column input_tokens integer not null default 0;
  alter table provider_usage_windows add column output_tokens integer not null default 0;
  alter table provider_usage_windows add column cached_input_tokens integer not null default 0;
  alter table provider_usage_windows add column reasoning_tokens integer not null default 0;
  alter table provider_usage_windows add column cost_cents real not null default 0;
  alter table provider_usage_windows add column requests_without_usage integer not null default 0;
  alter table provider_usage_windows add column unpriced_requests integer not null default 0;

  insert into schema_migrations(version, name, applied_at)
  values (73, 'usage_window_tokens', datetime('now'));
`;
