export const sdlcControlsSchema = `
  create table if not exists sdlc_review_agents (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    key text not null,
    label text not null,
    specialty text not null,
    enabled integer not null check(enabled in (0, 1)),
    created_at text not null,
    updated_at text not null,
    unique(org_id, key)
  );

  create table if not exists sdlc_review_runs (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    review_agent_id text not null references sdlc_review_agents(id) on delete cascade,
    target_type text not null,
    target_ref text not null,
    state text not null,
    result_json text not null,
    created_at text not null,
    completed_at text not null
  );

  create table if not exists eval_suites (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    key text not null,
    label text not null,
    scope text not null,
    created_at text not null,
    updated_at text not null,
    unique(org_id, key)
  );

  create table if not exists eval_cases (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    suite_id text not null references eval_suites(id) on delete cascade,
    title text not null,
    source_type text not null,
    source_ref text not null,
    expected_signal text not null,
    created_at text not null,
    unique(suite_id, title)
  );

  create table if not exists eval_runs (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    suite_id text not null references eval_suites(id) on delete cascade,
    state text not null,
    passed_count integer not null,
    failed_count integer not null,
    result_json text not null,
    created_at text not null,
    completed_at text not null
  );

  create table if not exists pr_bot_gates (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    key text not null,
    label text not null,
    gate_type text not null,
    enabled integer not null check(enabled in (0, 1)),
    created_at text not null,
    updated_at text not null,
    unique(org_id, key)
  );

  create index if not exists idx_sdlc_review_runs_org_agent_created
    on sdlc_review_runs(org_id, review_agent_id, created_at);

  create index if not exists idx_eval_runs_org_suite_created
    on eval_runs(org_id, suite_id, created_at);

  insert into sdlc_review_agents(id, org_id, key, label, specialty, enabled, created_at, updated_at)
  select 'sra_' || lower(hex(randomblob(16))), organizations.id, seed.key, seed.label, seed.specialty, 1, datetime('now'), datetime('now')
  from organizations
  cross join (
    select 'code_reviewer' as key, 'Code Review Agent' as label, 'static quality and architecture' as specialty
    union all select 'migration_reviewer', 'Migration Review Agent', 'schema diff and rollback evidence'
    union all select 'policy_reviewer', 'Policy Review Agent', 'provider, approval, and access policy'
  ) seed
  where not exists (
    select 1 from sdlc_review_agents
    where sdlc_review_agents.org_id = organizations.id and sdlc_review_agents.key = seed.key
  );

  insert into eval_suites(id, org_id, key, label, scope, created_at, updated_at)
  select 'evs_' || lower(hex(randomblob(16))), organizations.id, seed.key, seed.label, seed.scope, datetime('now'), datetime('now')
  from organizations
  cross join (
    select 'contract' as key, 'Contract checks' as label, 'provider adapters, event schemas, slash commands' as scope
    union all select 'integration', 'Integration checks', 'chat, approval, file, skill resolution flows'
    union all select 'replay', 'Replay checks', 'audit timeline and historical decision regression'
  ) seed
  where not exists (
    select 1 from eval_suites
    where eval_suites.org_id = organizations.id and eval_suites.key = seed.key
  );

  insert into eval_cases(id, org_id, suite_id, title, source_type, source_ref, expected_signal, created_at)
  select 'evc_' || lower(hex(randomblob(16))), eval_suites.org_id, eval_suites.id, seed.title, seed.source_type, seed.source_ref, seed.expected_signal, datetime('now')
  from eval_suites
  join (
    select 'contract' as suite_key, 'Provider catalog has adapters' as title, 'provider_gateway' as source_type, 'providers' as source_ref, 'adapter_coverage' as expected_signal
    union all select 'contract', 'Schema ledger is current', 'database', 'schema_migrations', 'migration_ledger'
    union all select 'integration', 'Approval routes are assigned', 'org_governance', 'approval_assignments', 'route_coverage'
    union all select 'integration', 'Skills can resolve runtime snapshots', 'skills_platform', 'skill_runtime_snapshots', 'skill_resolution'
    union all select 'replay', 'Audit timeline has domain events', 'audit', 'audit_events', 'replayable_timeline'
    union all select 'replay', 'Operational signals are captured', 'operations', 'operational_events', 'slo_signal'
  ) seed on seed.suite_key = eval_suites.key
  where not exists (
    select 1 from eval_cases
    where eval_cases.suite_id = eval_suites.id and eval_cases.title = seed.title
  );

  insert into pr_bot_gates(id, org_id, key, label, gate_type, enabled, created_at, updated_at)
  select 'pbg_' || lower(hex(randomblob(16))), organizations.id, seed.key, seed.label, seed.gate_type, 1, datetime('now'), datetime('now')
  from organizations
  cross join (
    select 'static_checks' as key, 'Static checks' as label, 'typecheck_lint_test' as gate_type
    union all select 'migration_diff', 'Migration diff' as label, 'schema_review' as gate_type
    union all select 'policy_diff', 'Policy diff' as label, 'policy_review' as gate_type
    union all select 'human_approval', 'Human approval' as label, 'approval_required' as gate_type
  ) seed
  where not exists (
    select 1 from pr_bot_gates
    where pr_bot_gates.org_id = organizations.id and pr_bot_gates.key = seed.key
  );

  insert into schema_migrations(version, name, applied_at)
  values (18, 'sdlc_controls', datetime('now'));
`;
