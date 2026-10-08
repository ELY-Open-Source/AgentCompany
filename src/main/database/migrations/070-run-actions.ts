export const runActionsSchema = `
  create table if not exists run_actions (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    run_id text not null references task_runs(id) on delete cascade,
    task_id text not null references tasks(id) on delete cascade,
    tool_name text not null,
    arguments_excerpt text not null,
    result_excerpt text not null,
    created_at text not null
  );
  create index if not exists idx_run_actions_task on run_actions(task_id);

  insert into schema_migrations(version, name, applied_at)
  values (70, 'run_actions', datetime('now'));
`;
