export const documentVersionsSchema = `
  alter table documents add column version integer not null default 1;

  create table if not exists document_versions (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    document_id text not null,
    version integer not null,
    title text not null,
    content text not null,
    status text not null,
    changed_by_type text not null,
    changed_by_id text,
    reason text not null,
    created_at text not null,
    unique (document_id, version)
  );

  insert into document_versions(id, org_id, document_id, version, title, content, status, changed_by_type, changed_by_id, reason, created_at)
  select 'dov_' || lower(hex(randomblob(16))), org_id, id, 1, title, content, status,
         case when author_agent_id is null then 'employee' else 'agent' end, author_agent_id, 'created', created_at
  from documents;

  insert into schema_migrations(version, name, applied_at)
  values (65, 'document_versions', datetime('now'));
`;
