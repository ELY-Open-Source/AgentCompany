export const documentsKnowledgeAutomationSchema = `
  create table if not exists documents (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    title text not null,
    doc_type text not null,
    content text not null,
    status text not null,
    author_agent_id text references agents(id) on delete set null,
    reviewer_agent_id text references agents(id) on delete set null,
    project_id text references projects(id) on delete set null,
    goal_id text references goals(id) on delete set null,
    task_id text references tasks(id) on delete set null,
    created_at text not null,
    updated_at text not null
  );

  create index if not exists idx_documents_org on documents(org_id, doc_type);

  create table if not exists knowledge_entries (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    topic text not null,
    category text not null,
    content text not null,
    importance text not null,
    source_type text not null,
    source_id text,
    created_at text not null,
    updated_at text not null
  );

  create index if not exists idx_knowledge_org on knowledge_entries(org_id, category);

  create table if not exists automation_rules (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    name text not null,
    trigger_event text not null,
    condition_json text not null,
    action_type text not null,
    action_config_json text not null,
    priority integer not null,
    enabled integer not null,
    last_fired_at text,
    fire_count integer not null default 0,
    created_at text not null,
    updated_at text not null
  );

  create index if not exists idx_automation_org on automation_rules(org_id, enabled);
`;
