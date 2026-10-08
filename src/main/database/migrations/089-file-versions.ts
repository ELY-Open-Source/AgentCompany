export const fileVersionsSchema = `
  alter table file_objects add column source_path text;
  alter table file_objects add column superseded_at text;
  update file_objects set source_path = storage_path where source_path is null;
  create index if not exists file_objects_source on file_objects(org_id, source_path, sha256);

  insert into schema_migrations(version, name, applied_at)
  values (89, 'file_versions', datetime('now'));
`;
