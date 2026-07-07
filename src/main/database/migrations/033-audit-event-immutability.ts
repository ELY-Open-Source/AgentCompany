export const auditEventImmutabilitySchema = `
  create trigger if not exists trg_audit_events_no_update
  before update on audit_events
  begin
    select raise(abort, 'Audit events are immutable.');
  end;

  create trigger if not exists trg_audit_events_no_delete
  before delete on audit_events
  begin
    select raise(abort, 'Audit events are immutable.');
  end;

  insert into schema_migrations(version, name, applied_at)
  values (33, 'audit_event_immutability', datetime('now'));
`;
