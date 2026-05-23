export const orgGovernanceSchema = `
  create table if not exists org_departments (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    name text not null,
    lead_agent_id text references agents(id) on delete set null,
    headcount_limit integer not null,
    monthly_budget_limit_cents integer not null,
    created_at text not null,
    updated_at text not null,
    unique(org_id, name)
  );

  create table if not exists hiring_policies (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    department_name text not null,
    max_headcount integer not null,
    monthly_budget_limit_cents integer not null,
    require_approval_above_cents integer not null,
    created_at text not null,
    updated_at text not null,
    unique(org_id, department_name)
  );

  create table if not exists approval_routing_rules (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    kind text not null,
    minimum_risk text not null,
    route_to_type text not null,
    route_to_id text not null,
    created_at text not null,
    unique(org_id, kind, minimum_risk)
  );

  create table if not exists approval_assignments (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    approval_id text not null references approvals(id) on delete cascade,
    assignee_type text not null,
    assignee_id text not null,
    routing_rule_id text references approval_routing_rules(id) on delete set null,
    created_at text not null,
    unique(approval_id, assignee_type, assignee_id)
  );

  create index if not exists idx_org_departments_org_name on org_departments(org_id, name);
  create index if not exists idx_hiring_policies_org_department on hiring_policies(org_id, department_name);
  create index if not exists idx_approval_assignments_org_approval on approval_assignments(org_id, approval_id);

  insert into org_departments(id, org_id, name, lead_agent_id, headcount_limit, monthly_budget_limit_cents, created_at, updated_at)
  select 'dep_' || lower(hex(randomblob(16))), organizations.id, seed.name, null, 12, 2500000, datetime('now'), datetime('now')
  from organizations
  cross join (
    select 'Executive' as name union all select 'Engineering' union all select 'Product' union all select 'Design'
    union all select 'Marketing' union all select 'Operations' union all select 'Support'
  ) seed
  where not exists (
    select 1 from org_departments
    where org_departments.org_id = organizations.id and org_departments.name = seed.name
  );

  insert into hiring_policies(id, org_id, department_name, max_headcount, monthly_budget_limit_cents, require_approval_above_cents, created_at, updated_at)
  select 'hpl_' || lower(hex(randomblob(16))), org_id, name, headcount_limit, monthly_budget_limit_cents, 500000, datetime('now'), datetime('now')
  from org_departments
  where not exists (
    select 1 from hiring_policies
    where hiring_policies.org_id = org_departments.org_id and hiring_policies.department_name = org_departments.name
  );

  insert into approval_routing_rules(id, org_id, kind, minimum_risk, route_to_type, route_to_id, created_at)
  select 'arr_' || lower(hex(randomblob(16))), organizations.id, '*', 'low', 'employee', employees.id, datetime('now')
  from organizations
  join employees on employees.org_id = organizations.id
  where employees.id = (
    select first_employee.id from employees first_employee
    where first_employee.org_id = organizations.id
    order by first_employee.created_at asc
    limit 1
  )
  and not exists (
    select 1 from approval_routing_rules
    where approval_routing_rules.org_id = organizations.id and approval_routing_rules.kind = '*' and approval_routing_rules.minimum_risk = 'low'
  );

  insert into schema_migrations(version, name, applied_at)
  values (16, 'org_governance', datetime('now'));
`;
