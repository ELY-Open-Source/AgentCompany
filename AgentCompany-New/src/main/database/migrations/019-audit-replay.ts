export const auditReplaySchema = `
  create table if not exists audit_replay_runs (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    thread_id text not null references chat_threads(id) on delete cascade,
    event_count integer not null,
    event_digest text not null,
    replay_json text not null,
    created_by_employee_id text references employees(id) on delete set null,
    created_at text not null
  );

  create index if not exists idx_audit_replay_runs_org_created on audit_replay_runs(org_id, created_at);
  create index if not exists idx_audit_replay_runs_thread on audit_replay_runs(thread_id, created_at);

  insert into schema_migrations(version, name, applied_at)
  values (19, 'audit_replay', datetime('now'));
`;
