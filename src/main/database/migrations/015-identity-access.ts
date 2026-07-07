export const identityAccessSchema = `
  create table if not exists employee_identities (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    employee_id text not null references employees(id) on delete cascade,
    source text not null,
    external_subject text not null,
    email text,
    active integer not null,
    created_at text not null,
    last_seen_at text,
    unique(org_id, source, external_subject)
  );

  create table if not exists service_identities (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    agent_id text not null references agents(id) on delete cascade,
    name text not null,
    scope_json text not null,
    created_at text not null,
    unique(org_id, agent_id)
  );

  create table if not exists role_grants (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    principal_type text not null,
    principal_id text not null,
    role_key text not null,
    scope_type text not null,
    scope_id text not null,
    granted_by_employee_id text references employees(id) on delete set null,
    created_at text not null,
    unique(org_id, principal_type, principal_id, role_key, scope_type, scope_id)
  );

  create table if not exists access_decisions (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    principal_type text not null,
    principal_id text not null,
    action text not null,
    resource_type text not null,
    resource_id text not null,
    decision text not null,
    reason text not null,
    created_at text not null
  );

  create index if not exists idx_role_grants_principal on role_grants(org_id, principal_type, principal_id);
  create index if not exists idx_access_decisions_org_created on access_decisions(org_id, created_at);

  insert into employee_identities(id, org_id, employee_id, source, external_subject, email, active, created_at, last_seen_at)
  select 'eid_' || lower(hex(randomblob(16))), org_id, id, 'bootstrap', id, null, 1, datetime('now'), datetime('now')
  from employees
  where not exists (
    select 1 from employee_identities
    where employee_identities.org_id = employees.org_id and employee_identities.employee_id = employees.id
  );

  insert into role_grants(id, org_id, principal_type, principal_id, role_key, scope_type, scope_id, granted_by_employee_id, created_at)
  select 'rgr_' || lower(hex(randomblob(16))), org_id, 'employee', id, seed_role_key, 'organization', org_id, null, datetime('now')
  from employees
  cross join (
    select 'org_admin' as seed_role_key
    union all select 'approval_decider'
    union all select 'hiring_manager'
  )
  where not exists (
    select 1 from role_grants
    where role_grants.org_id = employees.org_id
      and role_grants.principal_type = 'employee'
      and role_grants.principal_id = employees.id
      and role_grants.role_key = seed_role_key
      and role_grants.scope_type = 'organization'
      and role_grants.scope_id = employees.org_id
  );

  insert into service_identities(id, org_id, agent_id, name, scope_json, created_at)
  select 'sid_' || lower(hex(randomblob(16))), org_id, id, name || ' service identity', json_object('agentId', id), datetime('now')
  from agents
  where not exists (
    select 1 from service_identities
    where service_identities.org_id = agents.org_id and service_identities.agent_id = agents.id
  );

  insert into schema_migrations(version, name, applied_at)
  values (15, 'identity_access', datetime('now'));
`;
