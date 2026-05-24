export const providerAuthSessionsSchema = `
  create table if not exists provider_auth_sessions (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    provider_id text not null references providers(id) on delete cascade,
    provider_key text not null,
    employee_id text not null references employees(id) on delete cascade,
    state text not null,
    nonce text not null,
    code_verifier_sha256 text not null,
    redirect_uri text not null,
    sign_in_url text not null,
    partition text not null,
    created_at text not null,
    expires_at text not null,
    completed_at text,
    unique(provider_id, state)
  );

  create index if not exists idx_provider_auth_sessions_org_provider
    on provider_auth_sessions(org_id, provider_id, created_at);
  create index if not exists idx_provider_auth_sessions_employee
    on provider_auth_sessions(org_id, employee_id, created_at);

  insert into schema_migrations(version, name, applied_at)
  values (34, 'provider_auth_sessions', datetime('now'));
`;
