export const fileHandoffRecordsSchema = `
  create table if not exists file_handoff_records (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    message_id text not null references chat_messages(id) on delete cascade,
    file_id text not null references file_objects(id) on delete cascade,
    source_principal_type text not null,
    source_principal_id text,
    target_principal_type text not null,
    target_principal_id text not null,
    transfer_type text not null,
    checksum text not null,
    scan_state text not null,
    scan_labels_json text not null,
    policy_decision text not null,
    object_ref text not null,
    created_at text not null,
    unique(message_id, file_id, target_principal_type, target_principal_id)
  );

  insert into file_handoff_records(
    id, org_id, message_id, file_id, source_principal_type, source_principal_id,
    target_principal_type, target_principal_id, transfer_type, checksum, scan_state,
    scan_labels_json, policy_decision, object_ref, created_at
  )
  select
    'fhr_' || lower(hex(randomblob(16))),
    messages.org_id,
    attachments.message_id,
    attachments.file_id,
    messages.sender_type,
    messages.sender_id,
    coalesce(grants.granted_to_type, 'org_group'),
    coalesce(grants.granted_to_id, messages.org_id || ':workspace'),
    attachments.transfer_type,
    attachments.checksum,
    files.scan_state,
    files.scan_labels_json,
    case
      when files.scan_state = 'approved' then 'approved_for_handoff'
      else 'blocked_by_scan'
    end,
    files.storage_path,
    messages.created_at
  from chat_attachments attachments
  join chat_messages messages on messages.id = attachments.message_id
  join file_objects files on files.id = attachments.file_id
  left join file_access_grants grants
    on grants.file_id = attachments.file_id
    and grants.source_message_id = attachments.message_id
  where not exists (
    select 1 from file_handoff_records records
    where records.message_id = attachments.message_id
      and records.file_id = attachments.file_id
      and records.target_principal_type = coalesce(grants.granted_to_type, 'org_group')
      and records.target_principal_id = coalesce(grants.granted_to_id, messages.org_id || ':workspace')
  );

  create index if not exists idx_file_handoff_org_created on file_handoff_records(org_id, created_at);
  create index if not exists idx_file_handoff_file on file_handoff_records(org_id, file_id);
  create index if not exists idx_file_handoff_target on file_handoff_records(org_id, target_principal_type, target_principal_id);

  insert into schema_migrations(version, name, applied_at)
  values (29, 'file_handoff_records', datetime('now'));
`;
