export const initialEnterpriseSchema = `
  create table if not exists organizations (
    id text primary key,
    name text not null,
    mission text not null,
    goal text not null,
    created_at text not null
  );

  create table if not exists employees (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    display_name text not null,
    role text not null,
    created_at text not null
  );

  create table if not exists agents (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    name text not null,
    role text not null,
    department text not null,
    model_provider_id text,
    model_id text,
    budget_cents integer not null,
    manager_agent_id text references agents(id) on delete set null,
    lifecycle text not null,
    created_at text not null
  );

  create table if not exists tasks (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    title text not null,
    description text not null,
    status text not null,
    assignee_agent_id text references agents(id) on delete set null,
    risk text not null,
    created_at text not null,
    updated_at text not null
  );

  create table if not exists approvals (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    kind text not null,
    title text not null,
    details text not null,
    risk text not null,
    requested_by_type text not null,
    requested_by_id text,
    state text not null,
    decided_by_employee_id text references employees(id) on delete set null,
    created_at text not null,
    decided_at text
  );

  create table if not exists chat_spaces (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    space_type text not null,
    name text not null,
    topic text not null,
    visibility text not null,
    created_at text not null
  );

  create table if not exists chat_memberships (
    space_id text not null references chat_spaces(id) on delete cascade,
    principal_type text not null,
    principal_id text not null,
    role text not null,
    mute_state text not null,
    primary key (space_id, principal_type, principal_id)
  );

  create table if not exists chat_messages (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    space_id text not null references chat_spaces(id) on delete cascade,
    thread_id text,
    sender_type text not null,
    sender_id text,
    body_md text not null,
    created_at text not null,
    edited_at text,
    deleted_at text
  );

  create table if not exists file_objects (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    name text not null,
    kind text not null,
    size_bytes integer not null,
    sha256 text not null,
    storage_path text not null,
    owner_type text not null,
    owner_id text,
    created_at text not null
  );

  create table if not exists providers (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    provider_key text not null,
    label text not null,
    auth_type text not null,
    model text,
    credential_id text,
    enabled integer not null,
    created_at text not null,
    unique(org_id, provider_key)
  );

  create table if not exists credentials (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    provider_key text not null,
    kind text not null,
    ciphertext blob not null,
    display_hint text not null,
    created_at text not null
  );

  create table if not exists skill_definitions (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    slug text not null,
    name text not null,
    owner_type text not null,
    status text not null,
    created_at text not null,
    unique(org_id, slug)
  );

  create table if not exists skill_revisions (
    id text primary key,
    skill_id text not null references skill_definitions(id) on delete cascade,
    version_semver text not null,
    manifest_json text not null,
    source_type text not null,
    source_ref text not null,
    published_at text not null,
    immutable_checksum text not null,
    unique(skill_id, version_semver)
  );

  create table if not exists skill_artifacts (
    id text primary key,
    revision_id text not null references skill_revisions(id) on delete cascade,
    artifact_type text not null,
    object_key text not null,
    sha256 text not null,
    size_bytes integer not null
  );

  create table if not exists skill_tests (
    id text primary key,
    revision_id text not null references skill_revisions(id) on delete cascade,
    test_type text not null,
    expected_output_ref text not null,
    last_result text,
    last_run_at text
  );

  create table if not exists skill_bindings (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    agent_id text not null references agents(id) on delete cascade,
    skill_id text not null references skill_definitions(id) on delete cascade,
    pinned_revision_id text not null references skill_revisions(id) on delete cascade,
    binding_mode text not null,
    priority integer not null,
    enabled integer not null,
    unique(agent_id, skill_id)
  );

  create table if not exists social_accounts (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    platform text not null,
    handle text not null,
    display_name text not null,
    authorized_employee_id text references employees(id) on delete set null,
    created_at text not null
  );

  create table if not exists social_account_grants (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    social_account_id text not null references social_accounts(id) on delete cascade,
    employee_id text not null references employees(id) on delete cascade,
    role text not null,
    scope_json text not null,
    created_at text not null
  );

  create table if not exists browser_actions (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    social_account_id text not null references social_accounts(id) on delete cascade,
    action_type text not null,
    policy_decision text not null,
    evidence_file_id text references file_objects(id) on delete set null,
    created_at text not null
  );

  create table if not exists migration_reports (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    source_ref text not null,
    report_json text not null,
    created_at text not null
  );

  create table if not exists audit_events (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    entity_type text not null,
    entity_id text not null,
    actor_type text not null,
    actor_id text,
    action text not null,
    payload_json text not null,
    created_at text not null
  );

  create index if not exists idx_tasks_org_status on tasks(org_id, status);
  create index if not exists idx_messages_space_created on chat_messages(space_id, created_at);
  create index if not exists idx_audit_org_created on audit_events(org_id, created_at);
  insert into schema_migrations(version, name, applied_at)
  values (1, 'initial_enterprise_schema', datetime('now'));
`;
