export const heldDeliverablesSchema = `
  create table if not exists held_deliverables (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    approval_id text not null,
    kind text not null check (kind in ('file', 'document_create', 'document_update')),
    agent_id text,
    task_id text,
    goal_id text,
    project_id text,
    workspace_root text,
    relative_path text,
    document_id text,
    base_version integer,
    title text,
    doc_type text,
    reason text,
    content text not null,
    state text not null check (state in ('held', 'published', 'declined')),
    created_at text not null
  );
  create index if not exists held_deliverables_task on held_deliverables(task_id, state);
  create index if not exists held_deliverables_goal on held_deliverables(goal_id, state);

  insert into schema_migrations(version, name, applied_at)
  values (86, 'held_deliverables', datetime('now'));
`;
