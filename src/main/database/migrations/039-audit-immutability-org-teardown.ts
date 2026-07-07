// The audit_events and social_audit_records immutability triggers raised ABORT
// on EVERY delete, including the legitimate cascade when an organization is torn
// down — so deleting an organization always rolled back. These rebuilt triggers
// still block tampering deletes of individual records (the owning org exists),
// but allow the cascade once the organization row itself is gone. Direct
// deletes of audit rows whose org still exists remain forbidden.
export const auditImmutabilityOrgTeardownSchema = `
  drop trigger if exists trg_audit_events_no_delete;
  create trigger trg_audit_events_no_delete
  before delete on audit_events
  for each row
  when exists (select 1 from organizations where id = old.org_id)
  begin
    select raise(abort, 'Audit events are immutable.');
  end;

  drop trigger if exists trg_social_audit_records_no_delete;
  create trigger trg_social_audit_records_no_delete
  before delete on social_audit_records
  for each row
  when exists (select 1 from organizations where id = old.org_id)
  begin
    select raise(abort, 'Social audit records are immutable.');
  end;

  insert into schema_migrations(version, name, applied_at)
  values (39, 'audit_immutability_org_teardown', datetime('now'));
`;
