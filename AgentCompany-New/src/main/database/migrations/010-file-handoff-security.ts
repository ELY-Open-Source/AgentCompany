export const fileHandoffSecuritySchema = `
  alter table file_objects add column scan_state text not null default 'approved';
  alter table file_objects add column scan_labels_json text not null default '[]';
  alter table file_objects add column scanned_at text;

  create table if not exists file_access_grants (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    file_id text not null references file_objects(id) on delete cascade,
    granted_to_type text not null,
    granted_to_id text not null,
    granted_by_type text not null,
    granted_by_id text,
    source_message_id text references chat_messages(id) on delete set null,
    source_thread_id text references chat_threads(id) on delete set null,
    access_level text not null,
    created_at text not null,
    unique(file_id, granted_to_type, granted_to_id, source_message_id, access_level)
  );

  insert into file_access_grants(
    id, org_id, file_id, granted_to_type, granted_to_id, granted_by_type, granted_by_id,
    source_message_id, source_thread_id, access_level, created_at
  )
  select
    'fgr_' || lower(hex(randomblob(16))),
    org_id,
    id,
    'org_group',
    org_id || ':workspace',
    'system',
    null,
    null,
    null,
    'manage',
    coalesce(created_at, datetime('now'))
  from file_objects
  where owner_type = 'system'
    and not exists (
      select 1 from file_access_grants
      where file_access_grants.file_id = file_objects.id
        and file_access_grants.granted_to_type = 'org_group'
        and file_access_grants.granted_to_id = file_objects.org_id || ':workspace'
    );

  create index if not exists idx_file_grants_org_file on file_access_grants(org_id, file_id);
  create index if not exists idx_file_grants_principal on file_access_grants(org_id, granted_to_type, granted_to_id);
  create index if not exists idx_files_org_scan on file_objects(org_id, scan_state);

  insert into schema_migrations(version, name, applied_at)
  values (10, 'file_handoff_security', datetime('now'));
`;
