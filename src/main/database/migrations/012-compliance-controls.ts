export const complianceControlsSchema = `
  alter table chat_spaces add column retention_policy text not null default 'standard_365d';

  create table if not exists compliance_exports (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    subject_type text not null,
    subject_id text not null,
    export_type text not null,
    state text not null,
    payload_json text not null,
    requested_by_employee_id text references employees(id) on delete set null,
    created_at text not null,
    completed_at text
  );

  create table if not exists legal_holds (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    entity_type text not null,
    entity_id text not null,
    reason text not null,
    created_by_employee_id text references employees(id) on delete set null,
    active integer not null,
    created_at text not null,
    released_at text
  );

  create table if not exists retention_freezes (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    scope_type text not null,
    scope_id text not null,
    reason text not null,
    created_by_employee_id text references employees(id) on delete set null,
    active integer not null,
    created_at text not null,
    released_at text
  );

  create index if not exists idx_compliance_exports_org_created on compliance_exports(org_id, created_at);
  create index if not exists idx_legal_holds_org_entity on legal_holds(org_id, entity_type, entity_id, active);
  create index if not exists idx_retention_freezes_org_scope on retention_freezes(org_id, scope_type, scope_id, active);

  insert into schema_migrations(version, name, applied_at)
  values (12, 'compliance_controls', datetime('now'));
`;
