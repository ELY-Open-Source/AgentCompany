export const providerAuthBrokerSchema = `
  create table if not exists provider_auth_profiles (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    provider_id text not null references providers(id) on delete cascade,
    credential_id text not null references credentials(id) on delete restrict,
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

  create index if not exists idx_provider_auth_profiles_org_provider
    on provider_auth_profiles(org_id, provider_id, created_at);
  create index if not exists idx_provider_auth_profiles_credential
    on provider_auth_profiles(credential_id);
  create unique index if not exists idx_provider_auth_profiles_active
    on provider_auth_profiles(provider_id) where active = 1;

  insert into provider_auth_profiles(
    id, org_id, provider_id, credential_id, provider_key, auth_type,
    profile_kind, display_hint, source_type, source_ref, capability_json,
    active, created_at
  )
  select
    'authp_' || lower(hex(randomblob(16))),
    providers.org_id,
    providers.id,
    credentials.id,
    providers.provider_key,
    providers.auth_type,
    providers.auth_type,
    credentials.display_hint,
    'migrated_credential',
    null,
    '{"providerKey":"' || providers.provider_key || '","authType":"' || providers.auth_type || '","capabilityTags":[]}',
    1,
    credentials.created_at
  from providers
  join credentials
    on credentials.id = providers.credential_id
    and credentials.org_id = providers.org_id
    and credentials.provider_key = providers.provider_key
  where providers.credential_id is not null
    and not exists (
      select 1
      from provider_auth_profiles existing_profiles
      where existing_profiles.provider_id = providers.id
        and existing_profiles.active = 1
    );

  insert into schema_migrations(version, name, applied_at)
  values (21, 'provider_auth_broker', datetime('now'));
`;
