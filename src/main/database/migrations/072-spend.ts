export const spendSchema = `
  alter table providers add column input_cents_per_mtok real;
  alter table providers add column cached_input_cents_per_mtok real;
  alter table providers add column output_cents_per_mtok real;

  alter table provider_requests add column agent_id text references agents(id) on delete set null;
  alter table provider_requests add column task_run_id text references task_runs(id) on delete set null;
  alter table provider_requests add column department text;
  alter table provider_requests add column input_tokens integer;
  alter table provider_requests add column output_tokens integer;
  alter table provider_requests add column cached_input_tokens integer;
  alter table provider_requests add column reasoning_tokens integer;
  alter table provider_requests add column cost_cents real;
  create index if not exists idx_provider_requests_agent_created on provider_requests(agent_id, created_at);

  insert into schema_migrations(version, name, applied_at)
  values (72, 'spend', datetime('now'));
`;
