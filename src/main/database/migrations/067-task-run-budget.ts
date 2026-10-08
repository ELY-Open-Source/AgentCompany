export const taskRunBudgetSchema = `
  alter table tasks add column stalled_reason text;
  alter table tasks add column run_budget_floor integer not null default 0;

  insert into schema_migrations(version, name, applied_at)
  values (67, 'task_run_budget', datetime('now'));
`;
