export const browserPlatformGovernanceSchema = `
  create table if not exists browser_session_containers (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    social_account_id text not null references social_accounts(id) on delete cascade,
    platform text not null,
    partition_key text not null,
    host_allowlist_json text not null,
    permission_policy text not null,
    sandbox_enabled integer not null,
    created_at text not null,
    last_used_at text,
    unique(social_account_id)
  );

  create table if not exists browser_action_policies (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    social_account_id text not null references social_accounts(id) on delete cascade,
    action_type text not null,
    content_category text not null,
    risk_level text not null,
    approval_required integer not null,
    approval_kind text,
    created_at text not null,
    unique(social_account_id, action_type, content_category)
  );

  create table if not exists social_approval_routes (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    social_account_id text not null references social_accounts(id) on delete cascade,
    action_type text not null,
    risk_level text not null,
    approval_kind text not null,
    route_to_type text not null,
    route_to_id text,
    created_at text not null,
    unique(social_account_id, action_type, risk_level)
  );

  insert into browser_session_containers(
    id, org_id, social_account_id, platform, partition_key, host_allowlist_json,
    permission_policy, sandbox_enabled, created_at, last_used_at
  )
  select
    'bsc_' || lower(hex(randomblob(16))),
    org_id,
    id,
    platform,
    'persist:agentcompany-social-' || id,
    case platform
      when 'x' then '["x.com","twitter.com"]'
      when 'linkedin' then '["linkedin.com","www.linkedin.com"]'
      when 'youtube' then '["accounts.google.com","youtube.com","www.youtube.com"]'
      when 'instagram' then '["instagram.com","www.instagram.com"]'
      else '[]'
    end,
    'deny_all',
    1,
    datetime('now'),
    null
  from social_accounts
  where not exists (
    select 1 from browser_session_containers
    where browser_session_containers.social_account_id = social_accounts.id
  );

  insert into browser_action_policies(
    id, org_id, social_account_id, action_type, content_category, risk_level,
    approval_required, approval_kind, created_at
  )
  select
    'bap_' || lower(hex(randomblob(16))),
    social_accounts.org_id,
    social_accounts.id,
    policy.action_type,
    policy.content_category,
    policy.risk_level,
    policy.approval_required,
    policy.approval_kind,
    datetime('now')
  from social_accounts
  join (
    select 'login' action_type, 'auth' content_category, 'low' risk_level, 0 approval_required, null approval_kind
    union all select 'draft', 'content', 'low', 0, null
    union all select 'approve', 'content', 'medium', 1, 'social_publish'
  ) policy
  where not exists (
    select 1 from browser_action_policies
    where browser_action_policies.social_account_id = social_accounts.id
      and browser_action_policies.action_type = policy.action_type
      and browser_action_policies.content_category = policy.content_category
  );

  insert into social_approval_routes(
    id, org_id, social_account_id, action_type, risk_level, approval_kind,
    route_to_type, route_to_id, created_at
  )
  select
    'sar_' || lower(hex(randomblob(16))),
    org_id,
    id,
    'approve',
    'medium',
    'social_publish',
    'authorized_employee',
    authorized_employee_id,
    datetime('now')
  from social_accounts
  where not exists (
    select 1 from social_approval_routes
    where social_approval_routes.social_account_id = social_accounts.id
      and social_approval_routes.action_type = 'approve'
      and social_approval_routes.risk_level = 'medium'
  );

  create index if not exists idx_browser_session_containers_org
    on browser_session_containers(org_id, social_account_id);
  create index if not exists idx_browser_action_policies_org_account
    on browser_action_policies(org_id, social_account_id, action_type);
  create index if not exists idx_social_approval_routes_org_account
    on social_approval_routes(org_id, social_account_id, action_type);

  insert into schema_migrations(version, name, applied_at)
  values (26, 'browser_platform_governance', datetime('now'));
`;
