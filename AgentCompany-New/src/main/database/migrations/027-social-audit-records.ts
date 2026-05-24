export const socialAuditRecordsSchema = `
  create table if not exists social_audit_records (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    social_account_id text references social_accounts(id) on delete set null,
    source_type text not null,
    source_id text,
    event_type text not null,
    actor_type text not null,
    actor_id text,
    policy_decision text not null,
    evidence_file_id text references file_objects(id) on delete set null,
    metadata_json text not null,
    created_at text not null,
    unique(source_type, source_id, event_type)
  );

  insert into social_audit_records(
    id, org_id, social_account_id, source_type, source_id, event_type,
    actor_type, actor_id, policy_decision, evidence_file_id, metadata_json, created_at
  )
  select
    'saud_' || lower(hex(randomblob(16))),
    org_id,
    social_account_id,
    'browser_action',
    id,
    action_type,
    'system',
    null,
    policy_decision,
    evidence_file_id,
    json_object('source', 'browser_actions'),
    created_at
  from browser_actions
  where not exists (
    select 1 from social_audit_records
    where social_audit_records.source_type = 'browser_action'
      and social_audit_records.source_id = browser_actions.id
      and social_audit_records.event_type = browser_actions.action_type
  );

  create index if not exists idx_social_audit_records_org_created
    on social_audit_records(org_id, created_at);
  create index if not exists idx_social_audit_records_account_created
    on social_audit_records(social_account_id, created_at);

  create trigger if not exists trg_social_audit_records_no_update
  before update on social_audit_records
  begin
    select raise(abort, 'Social audit records are immutable.');
  end;

  create trigger if not exists trg_social_audit_records_no_delete
  before delete on social_audit_records
  begin
    select raise(abort, 'Social audit records are immutable.');
  end;

  insert into schema_migrations(version, name, applied_at)
  values (27, 'social_audit_records', datetime('now'));
`;
