export const browserActionMetadataSchema = `
  alter table browser_actions add column metadata_json text not null default '{}';

  insert into schema_migrations(version, name, applied_at)
  values (32, 'browser_action_metadata', datetime('now'));
`;
