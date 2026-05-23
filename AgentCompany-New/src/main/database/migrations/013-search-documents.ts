export const searchDocumentsSchema = `
  create virtual table if not exists search_documents using fts5(
    org_id unindexed,
    entity_type unindexed,
    entity_id unindexed,
    title,
    body,
    facet_json unindexed
  );

  insert into schema_migrations(version, name, applied_at)
  values (13, 'search_documents', datetime('now'));
`;
