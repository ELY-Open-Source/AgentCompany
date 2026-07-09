export const financeSalesDepartmentsSchema = `
  insert into org_departments(id, org_id, name, lead_agent_id, headcount_limit, monthly_budget_limit_cents, created_at, updated_at)
  select 'dep_fin_' || o.id, o.id, 'Finance', null, 12, 2500000, datetime('now'), datetime('now')
  from organizations o
  where not exists (select 1 from org_departments d where d.org_id = o.id and lower(d.name) = 'finance');

  insert into org_departments(id, org_id, name, lead_agent_id, headcount_limit, monthly_budget_limit_cents, created_at, updated_at)
  select 'dep_sal_' || o.id, o.id, 'Sales', null, 12, 2500000, datetime('now'), datetime('now')
  from organizations o
  where not exists (select 1 from org_departments d where d.org_id = o.id and lower(d.name) = 'sales');

  insert into hiring_policies(id, org_id, department_name, max_headcount, monthly_budget_limit_cents, require_approval_above_cents, created_at, updated_at)
  select 'hpl_fin_' || o.id, o.id, 'Finance', 12, 2500000, 500000, datetime('now'), datetime('now')
  from organizations o
  where not exists (select 1 from hiring_policies hp where hp.org_id = o.id and lower(hp.department_name) = 'finance');

  insert into hiring_policies(id, org_id, department_name, max_headcount, monthly_budget_limit_cents, require_approval_above_cents, created_at, updated_at)
  select 'hpl_sal_' || o.id, o.id, 'Sales', 12, 2500000, 500000, datetime('now'), datetime('now')
  from organizations o
  where not exists (select 1 from hiring_policies hp where hp.org_id = o.id and lower(hp.department_name) = 'sales');

  insert into schema_migrations(version, name, applied_at)
  values (50, 'finance_sales_departments', datetime('now'));
`;
