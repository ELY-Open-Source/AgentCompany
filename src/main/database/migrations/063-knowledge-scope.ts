export const knowledgeScopeSchema = `
  alter table knowledge_entries add column scope_type text not null default 'organization';
  alter table knowledge_entries add column scope_id text;
  alter table knowledge_entries add column valid_until text;
  alter table knowledge_entries add column superseded_by text;

  insert into schema_migrations(version, name, applied_at)
  values (63, 'knowledge_scope', datetime('now'));
`;
