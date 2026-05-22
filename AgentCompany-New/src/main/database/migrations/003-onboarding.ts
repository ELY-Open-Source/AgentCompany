export const onboardingExecutionSchema = `
  alter table organizations add column description text not null default '';
  alter table organizations add column execution_mode text not null default 'ai_ceo';
  alter table organizations add column auto_approve_hires integer not null default 1;
  alter table organizations add column review_deliverables integer not null default 0;

  alter table agents add column title text not null default '';
  alter table agents add column role_level text not null default 'staff';
  alter table agents add column model_strategy text not null default 'pooled';
  alter table agents add column workspace_id text;
  alter table agents add column heartbeat_enabled integer not null default 0;
  alter table agents add column heartbeat_interval_sec integer not null default 0;

  alter table tasks add column project_id text;
  alter table tasks add column goal_id text;
  alter table tasks add column workspace_id text;
  alter table tasks add column priority text not null default 'normal';
  alter table tasks add column requires_filesystem integer not null default 0;

  create table if not exists workspaces (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    name text not null,
    local_path text not null,
    repo_url text not null,
    repo_ref text not null,
    project_id text,
    is_primary integer not null,
    created_at text not null,
    updated_at text not null
  );

  create table if not exists goals (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    title text not null,
    description text not null,
    status text not null,
    owner_agent_id text references agents(id) on delete set null,
    created_at text not null,
    updated_at text not null
  );

  create table if not exists projects (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    goal_id text references goals(id) on delete set null,
    name text not null,
    description text not null,
    lead_agent_id text references agents(id) on delete set null,
    status text not null,
    created_at text not null,
    updated_at text not null
  );

  create table if not exists task_runs (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    task_id text not null references tasks(id) on delete cascade,
    agent_id text references agents(id) on delete set null,
    provider_id text references providers(id) on delete set null,
    trigger text not null,
    state text not null,
    created_at text not null,
    started_at text,
    completed_at text,
    error_message text
  );

  create index if not exists idx_workspaces_org_primary on workspaces(org_id, is_primary);
  create index if not exists idx_goals_org_status on goals(org_id, status);
  create index if not exists idx_projects_org_status on projects(org_id, status);
  create index if not exists idx_task_runs_task_created on task_runs(task_id, created_at);
  insert into schema_migrations(version, name, applied_at)
  values (3, 'onboarding_execution_schema', datetime('now'));
`;
