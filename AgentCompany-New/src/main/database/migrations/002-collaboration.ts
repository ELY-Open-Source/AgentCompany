export const collaborationProviderPolicySchema = `
  create table if not exists skill_dependencies (
    revision_id text not null references skill_revisions(id) on delete cascade,
    depends_on_revision_id text not null references skill_revisions(id) on delete cascade,
    dependency_kind text not null,
    optional integer not null,
    primary key (revision_id, depends_on_revision_id)
  );

  create table if not exists skill_runtime_snapshots (
    id text primary key,
    agent_id text not null references agents(id) on delete cascade,
    run_id text not null,
    compiled_prompt text not null,
    tools_manifest text not null,
    source_revision_ids text not null,
    created_at text not null
  );

  create table if not exists skill_catalog_tags (
    skill_id text not null references skill_definitions(id) on delete cascade,
    tag text not null,
    tag_type text not null,
    primary key (skill_id, tag, tag_type)
  );

  create table if not exists chat_threads (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    space_id text not null references chat_spaces(id) on delete cascade,
    root_message_id text references chat_messages(id) on delete set null,
    title text not null,
    state text not null,
    created_at text not null,
    updated_at text not null
  );

  create table if not exists chat_mentions (
    message_id text not null references chat_messages(id) on delete cascade,
    target_type text not null,
    target_id text not null,
    offset_start integer not null,
    offset_end integer not null
  );

  create table if not exists chat_attachments (
    message_id text not null references chat_messages(id) on delete cascade,
    file_id text not null references file_objects(id) on delete cascade,
    transfer_type text not null,
    checksum text not null,
    preview_key text
  );

  create table if not exists chat_presence (
    principal_type text not null,
    principal_id text not null,
    status text not null,
    status_text text not null,
    last_seen_at text not null,
    primary key (principal_type, principal_id)
  );

  create table if not exists chat_slash_invocations (
    id text primary key,
    message_id text not null references chat_messages(id) on delete cascade,
    command text not null,
    args_json text not null,
    result_ref text,
    created_at text not null
  );

  create table if not exists provider_requests (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    provider_id text not null references providers(id) on delete cascade,
    provider_key text not null,
    model text not null,
    prompt_sha256 text not null,
    response_text text,
    raw_response_json text,
    state text not null,
    error_message text,
    created_at text not null,
    completed_at text
  );

  create table if not exists policy_rules (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    subject_type text not null,
    subject_id text,
    action text not null,
    effect text not null,
    risk_ceiling text not null,
    created_at text not null
  );

  create index if not exists idx_provider_requests_org_created on provider_requests(org_id, created_at);
  create index if not exists idx_chat_threads_space_updated on chat_threads(space_id, updated_at);
  insert into policy_rules(id, org_id, subject_type, subject_id, action, effect, risk_ceiling, created_at)
  select
    'pol_' || lower(hex(randomblob(16))),
    id,
    'organization',
    id,
    'task_create',
    'require_approval',
    'medium',
    datetime('now')
  from organizations
  where not exists (
    select 1 from policy_rules
    where policy_rules.org_id = organizations.id and policy_rules.action = 'task_create'
  );
  insert into schema_migrations(version, name, applied_at)
  values (2, 'collaboration_provider_policy_schema', datetime('now'));
`;
