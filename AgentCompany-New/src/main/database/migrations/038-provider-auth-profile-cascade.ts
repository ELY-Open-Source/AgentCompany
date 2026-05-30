// Deleting an organization cascades into its `credentials`, but
// `provider_auth_profiles.credential_id` referenced `credentials(id)` with
// `on delete restrict`, which blocked the cascade and made the whole DELETE
// throw — so deleting an organization silently failed. This rebuilds the
// (leaf) table with `on delete cascade`, preserving every existing row and
// index. Revocation only deactivates a profile (active = 0) and never deletes
// a credential row, so cascade has no effect on normal operation.
export const providerAuthProfileCascadeSchema = `
  create table provider_auth_profiles_rebuild (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    provider_id text not null references providers(id) on delete cascade,
    credential_id text not null references credentials(id) on delete cascade,
    provider_key text not null,
    auth_type text not null,
    profile_kind text not null,
    display_hint text not null,
    source_type text not null,
    source_ref text,
    capability_json text not null,
    active integer not null check(active in (0, 1)),
    created_at text not null
  );

  insert into provider_auth_profiles_rebuild(
    id, org_id, provider_id, credential_id, provider_key, auth_type,
    profile_kind, display_hint, source_type, source_ref, capability_json, active, created_at
  )
  select
    id, org_id, provider_id, credential_id, provider_key, auth_type,
    profile_kind, display_hint, source_type, source_ref, capability_json, active, created_at
  from provider_auth_profiles;

  drop table provider_auth_profiles;
  alter table provider_auth_profiles_rebuild rename to provider_auth_profiles;

  create index if not exists idx_provider_auth_profiles_org_provider
    on provider_auth_profiles(org_id, provider_id, created_at);
  create index if not exists idx_provider_auth_profiles_credential
    on provider_auth_profiles(credential_id);
  create unique index if not exists idx_provider_auth_profiles_active
    on provider_auth_profiles(provider_id) where active = 1;

  insert into schema_migrations(version, name, applied_at)
  values (38, 'provider_auth_profile_cascade', datetime('now'));
`;
