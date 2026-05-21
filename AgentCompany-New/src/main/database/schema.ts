import type { DatabaseSync } from "node:sqlite";

const SCHEMA_VERSION = 4;

export function installSchema(db: DatabaseSync): void {
  db.exec(`
    create table if not exists schema_migrations (
      version integer primary key,
      name text not null,
      applied_at text not null
    );
  `);

  const row = db.prepare("select coalesce(max(version), 0) as version from schema_migrations").get() as { version: number };
  let currentVersion = row.version;
  if (currentVersion > SCHEMA_VERSION) {
    throw new Error(`Database schema ${currentVersion} is newer than supported schema ${SCHEMA_VERSION}.`);
  }
  if (currentVersion === SCHEMA_VERSION) return;

  if (currentVersion < 1) {
    db.exec(`
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
  `);
    currentVersion = 1;
  }

  if (currentVersion < 2) {
    db.exec(`
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
    `);
    currentVersion = 2;
  }

  if (currentVersion < 3) {
    db.exec(`
      alter table organizations add column description text not null default '';
      alter table organizations add column execution_mode text not null default 'ai_ceo';
      alter table organizations add column auto_approve_hires integer not null default 1;
      alter table organizations add column review_deliverables integer not null default 0;

      alter table agents add column title text not null default '';
      alter table agents add column role_level text not null default 'staff';
      alter table agents add column model_strategy text not null default 'pooled';
      alter table agents add column workspace_id text;
      alter table agents add column heartbeat_enabled integer not null default 0;
      alter table agents add column heartbeat_interval_sec integer not null default 0;

      alter table tasks add column project_id text;
      alter table tasks add column goal_id text;
      alter table tasks add column workspace_id text;
      alter table tasks add column priority text not null default 'normal';
      alter table tasks add column requires_filesystem integer not null default 0;

      create table if not exists workspaces (
        id text primary key,
        org_id text not null references organizations(id) on delete cascade,
        name text not null,
        local_path text not null,
        repo_url text not null,
        repo_ref text not null,
        project_id text,
        is_primary integer not null,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists goals (
        id text primary key,
        org_id text not null references organizations(id) on delete cascade,
        title text not null,
        description text not null,
        status text not null,
        owner_agent_id text references agents(id) on delete set null,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists projects (
        id text primary key,
        org_id text not null references organizations(id) on delete cascade,
        goal_id text references goals(id) on delete set null,
        name text not null,
        description text not null,
        lead_agent_id text references agents(id) on delete set null,
        status text not null,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists task_runs (
        id text primary key,
        org_id text not null references organizations(id) on delete cascade,
        task_id text not null references tasks(id) on delete cascade,
        agent_id text references agents(id) on delete set null,
        provider_id text references providers(id) on delete set null,
        trigger text not null,
        state text not null,
        created_at text not null,
        started_at text,
        completed_at text,
        error_message text
      );

      create index if not exists idx_workspaces_org_primary on workspaces(org_id, is_primary);
      create index if not exists idx_goals_org_status on goals(org_id, status);
      create index if not exists idx_projects_org_status on projects(org_id, status);
      create index if not exists idx_task_runs_task_created on task_runs(task_id, created_at);
      insert into schema_migrations(version, name, applied_at)
      values (3, 'onboarding_execution_schema', datetime('now'));
    `);
    currentVersion = 3;
  }

  if (currentVersion < 4) {
    db.exec(`
      alter table file_objects add column pinned integer not null default 0;
      alter table file_objects add column space_id text;
      alter table file_objects add column updated_at text;

      create table if not exists scheduled_posts (
        id text primary key,
        org_id text not null references organizations(id) on delete cascade,
        social_account_id text not null references social_accounts(id) on delete cascade,
        body_md text not null,
        scheduled_for text not null,
        state text not null,
        approval_id text references approvals(id) on delete set null,
        created_by_employee_id text references employees(id) on delete set null,
        created_at text not null,
        updated_at text not null
      );

      create index if not exists idx_files_org_pinned on file_objects(org_id, pinned);
      create index if not exists idx_scheduled_posts_org_state on scheduled_posts(org_id, state);
      create index if not exists idx_scheduled_posts_account_date on scheduled_posts(social_account_id, scheduled_for);

      insert into schema_migrations(version, name, applied_at)
      values (4, 'files_pinned_and_scheduled_posts', datetime('now'));
    `);
  }
}
