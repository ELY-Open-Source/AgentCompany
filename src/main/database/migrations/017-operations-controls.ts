export const operationsControlsSchema = `
  create table if not exists feature_flags (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    key text not null,
    label text not null,
    enabled integer not null check(enabled in (0, 1)),
    created_at text not null,
    updated_at text not null,
    unique(org_id, key)
  );

  create table if not exists slo_targets (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    signal_key text not null,
    label text not null,
    target_basis_points integer not null,
    window_minutes integer not null,
    created_at text not null,
    updated_at text not null,
    unique(org_id, signal_key)
  );

  create table if not exists operational_events (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    signal_key text not null,
    source text not null,
    success integer not null check(success in (0, 1)),
    duration_ms integer,
    detail_json text not null,
    created_at text not null
  );

  create table if not exists chaos_drills (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    key text not null,
    label text not null,
    scenario_key text not null,
    enabled integer not null check(enabled in (0, 1)),
    created_at text not null,
    updated_at text not null,
    unique(org_id, key)
  );

  create table if not exists chaos_drill_runs (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    drill_id text not null references chaos_drills(id) on delete cascade,
    state text not null,
    result_json text not null,
    started_at text not null,
    completed_at text not null
  );

  create index if not exists idx_operational_events_org_signal_created
    on operational_events(org_id, signal_key, created_at);

  create index if not exists idx_chaos_drill_runs_org_drill_started
    on chaos_drill_runs(org_id, drill_id, started_at);

  insert into feature_flags(id, org_id, key, label, enabled, created_at, updated_at)
  select 'ffg_' || lower(hex(randomblob(16))), organizations.id, seed.key, seed.label, seed.enabled, datetime('now'), datetime('now')
  from organizations
  cross join (
    select 'provider_background_execution' as key, 'Provider background execution' as label, 1 as enabled
    union all select 'social_publish_approval', 'Social publish approval', 1
    union all select 'board_intervention', 'Board intervention', 1
    union all select 'chaos_drills', 'Chaos drills', 1
  ) seed
  where not exists (
    select 1 from feature_flags
    where feature_flags.org_id = organizations.id and feature_flags.key = seed.key
  );

  insert into slo_targets(id, org_id, signal_key, label, target_basis_points, window_minutes, created_at, updated_at)
  select 'slo_' || lower(hex(randomblob(16))), organizations.id, seed.signal_key, seed.label, seed.target_basis_points, seed.window_minutes, datetime('now'), datetime('now')
  from organizations
  cross join (
    select 'provider_request_success' as signal_key, 'Provider requests' as label, 9950 as target_basis_points, 43200 as window_minutes
    union all select 'approval_route_coverage', 'Approval routing', 10000, 43200
    union all select 'browser_session_boundary', 'Browser session boundary', 10000, 43200
    union all select 'skill_resolve_success', 'Skill resolve', 9950, 43200
    union all select 'migration_validation_success', 'Migration validation', 10000, 43200
  ) seed
  where not exists (
    select 1 from slo_targets
    where slo_targets.org_id = organizations.id and slo_targets.signal_key = seed.signal_key
  );

  insert into chaos_drills(id, org_id, key, label, scenario_key, enabled, created_at, updated_at)
  select 'cdr_' || lower(hex(randomblob(16))), organizations.id, seed.key, seed.label, seed.scenario_key, 1, datetime('now'), datetime('now')
  from organizations
  cross join (
    select 'provider-outage-policy' as key, 'Provider outage policy' as label, 'provider_outage_policy_gate' as scenario_key
    union all select 'approval-backlog-routing', 'Approval backlog routing', 'approval_backlog_gate'
    union all select 'browser-session-boundary', 'Browser session boundary', 'browser_session_boundary'
    union all select 'migration-rollback-pack', 'Migration rollback pack', 'migration_rollback_pack'
  ) seed
  where not exists (
    select 1 from chaos_drills
    where chaos_drills.org_id = organizations.id and chaos_drills.key = seed.key
  );

  insert into schema_migrations(version, name, applied_at)
  values (17, 'operations_controls', datetime('now'));
`;
