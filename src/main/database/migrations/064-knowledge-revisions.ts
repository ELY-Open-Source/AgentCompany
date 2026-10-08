export const knowledgeRevisionsSchema = `
  create table if not exists knowledge_revisions (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    entry_id text not null,
    revision integer not null,
    topic text not null,
    category text not null,
    content text not null,
    importance text not null,
    changed_by_type text not null,
    changed_by_id text,
    reason text not null,
    created_at text not null,
    unique (entry_id, revision)
  );

  insert into knowledge_revisions(id, org_id, entry_id, revision, topic, category, content, importance, changed_by_type, changed_by_id, reason, created_at)
  select 'knr_' || lower(hex(randomblob(16))), org_id, id, 1, topic, category, content, importance, source_type, source_id, 'created', created_at
  from knowledge_entries;

  insert into schema_migrations(version, name, applied_at)
  values (64, 'knowledge_revisions', datetime('now'));
`;
