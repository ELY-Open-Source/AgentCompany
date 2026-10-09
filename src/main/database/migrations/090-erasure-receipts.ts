// Deletion records made before receipts copied the erased data into themselves; that copy is removed here.
// Audit events stay immutable except for one change: an erasure may replace a payload with the redaction marker, nothing else.
export const erasureReceiptsSchema = `
  update compliance_exports
  set payload_json = '{"erased":null,"note":"This record once held a copy of the erased data; it was removed."}'
  where export_type = 'gdpr_delete';

  drop trigger if exists trg_audit_events_no_update;
  create trigger trg_audit_events_no_update
  before update on audit_events
  for each row
  when not (
    new.payload_json is '{"redacted":true}'
    and new.id is old.id and new.org_id is old.org_id and new.entity_type is old.entity_type and new.entity_id is old.entity_id
    and new.actor_type is old.actor_type and new.actor_id is old.actor_id and new.action is old.action and new.created_at is old.created_at
  )
  begin
    select raise(abort, 'Audit events are immutable.');
  end;

  insert into schema_migrations(version, name, applied_at)
  values (90, 'erasure_receipts', datetime('now'));
`;
