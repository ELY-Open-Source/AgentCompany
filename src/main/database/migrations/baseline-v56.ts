import type { DatabaseSync } from "node:sqlite";

export const BASELINE_SCHEMA_VERSION = 56;
export const BASELINE_SCHEMA_NAME = "baseline_v56";

export const BASELINE_TABLE_SQL = [
  "CREATE TABLE activity (id text primary key, company_id text not null, actor text not null, action text not null, entity_type text not null, entity_id text not null, detail text not null, created_at text not null)",
  "CREATE TABLE agent_config_revisions (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, agent_id TEXT NOT NULL, revision_number INTEGER NOT NULL, changed_keys TEXT NOT NULL DEFAULT '[]', config_before TEXT NOT NULL, config_after TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'patch', rolled_back_from_revision_id TEXT, created_by_agent_id TEXT, created_by_user_id TEXT, created_at TEXT NOT NULL, FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE)",
  "CREATE TABLE agent_message_mentions (\n            message_id TEXT NOT NULL,\n            agent_id TEXT NOT NULL,\n            company_id TEXT NOT NULL,\n            created_at TEXT NOT NULL,\n            PRIMARY KEY (message_id, agent_id)\n          )",
  "CREATE TABLE agent_message_projections (\n            message_id TEXT NOT NULL,\n            session_id TEXT NOT NULL,\n            projected_at TEXT NOT NULL,\n            PRIMARY KEY (message_id, session_id)\n          )",
  "CREATE TABLE agent_message_reads (message_id text not null, agent_id text not null, read_at text not null, primary key (message_id, agent_id))",
  "CREATE TABLE agent_messages (id text primary key, company_id text not null, from_agent_id text not null, to_agent_id text, channel text not null default 'direct', channel_target_id text, subject text not null, body text not null, priority text not null default 'normal', parent_message_id text, attachments_json text not null default '[]', created_at text not null, sender_kind TEXT NOT NULL DEFAULT 'agent')",
  "CREATE TABLE agent_skill_assignments (agent_id TEXT NOT NULL, skill_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (agent_id, skill_id), FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE, FOREIGN KEY (skill_id) REFERENCES company_skills(id) ON DELETE CASCADE)",
  "CREATE TABLE agents (id text primary key, company_id text not null, name text not null, role text not null, title text not null, status text not null, reports_to text, connector_id text not null, workspace_id text, model text, capabilities text not null, budget_monthly_usd real not null default 0, spent_monthly_usd real not null default 0, metadata_json text not null default '{}', created_at text not null, updated_at text not null, department text, permissions_json TEXT NOT NULL DEFAULT '{}', heartbeat_policy_json TEXT, runtime_state_json TEXT, role_level TEXT NOT NULL DEFAULT 'ic', session_id TEXT, model_strategy TEXT NOT NULL DEFAULT 'explicit', heartbeat_enabled integer not null default 0, heartbeat_interval_sec integer not null default 120, last_heartbeat_at text)",
  "CREATE TABLE approval_comments (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, approval_id TEXT NOT NULL, author_agent_id TEXT, author_user_id TEXT, body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (approval_id) REFERENCES approvals(id) ON DELETE CASCADE)",
  "CREATE TABLE approvals (id text primary key, company_id text not null, related_task_id text, requested_by_agent_id text, type text not null, payload_summary text not null, impact_summary text not null, payload_json text, decision_note text not null default '', state text not null, created_at text not null, updated_at text not null, related_agent_id text)",
  "CREATE TABLE automation_log (id text primary key, company_id text not null, rule_id text not null, rule_name text not null, trigger text not null, action text not null, detail text not null default '', executed_at text not null)",
  "CREATE TABLE automation_rules (id text primary key, company_id text not null, name text not null, description text not null default '', trigger text not null, conditions_json text not null default '{}', action text not null, action_config_json text not null default '{}', source_department text, target_department text, priority integer not null default 50, status text not null default 'active', execution_count integer not null default 0, last_executed_at text, created_at text not null, updated_at text not null)",
  "CREATE TABLE browser_actions (id text primary key, company_id text not null references companies(id) on delete cascade, social_account_id text not null references social_accounts(id) on delete cascade, agent_id text not null references agents(id) on delete cascade, task_id text, action_type text not null default 'custom_script', payload_json text not null default '{}', status text not null default 'queued', result_summary text not null default '', screenshot_path text, approval_id text, error_message text, started_at text, finished_at text, created_at text not null default (datetime('now')), updated_at text not null default (datetime('now')))",
  "CREATE TABLE budget_incidents (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, policy_id TEXT NOT NULL REFERENCES budget_policies(id), scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, metric TEXT NOT NULL, window_kind TEXT NOT NULL, window_start TEXT NOT NULL, window_end TEXT NOT NULL, threshold_type TEXT NOT NULL, amount_limit INTEGER NOT NULL, amount_observed INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', resolved_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE TABLE budget_policies (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, metric TEXT NOT NULL DEFAULT 'billed_cents', window_kind TEXT NOT NULL DEFAULT 'calendar_month_utc', amount INTEGER NOT NULL DEFAULT 0, warn_percent INTEGER NOT NULL DEFAULT 80, hard_stop_enabled INTEGER NOT NULL DEFAULT 1, notify_enabled INTEGER NOT NULL DEFAULT 1, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE TABLE companies (id text primary key, name text not null, description text not null, status text not null, created_at text not null, updated_at text not null, auto_approve_hires integer not null default 0, review_deliverables integer not null default 0, execution_mode text not null default 'ai_ceo')",
  "CREATE TABLE \"company_skills\" (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, key TEXT NOT NULL, slug TEXT NOT NULL, name TEXT NOT NULL, description TEXT, source_type TEXT NOT NULL DEFAULT 'local_path', source_locator TEXT, source_ref TEXT, trust_level TEXT NOT NULL DEFAULT 'markdown_only', compatibility TEXT NOT NULL DEFAULT 'compatible', file_inventory TEXT NOT NULL DEFAULT '[]', metadata TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE TABLE connector_model_pool_settings (\n              company_id TEXT NOT NULL,\n              connector_id TEXT NOT NULL,\n              disabled_models_json TEXT NOT NULL DEFAULT '[]',\n              updated_at TEXT NOT NULL,\n              PRIMARY KEY (company_id, connector_id),\n              FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE\n            )",
  "CREATE TABLE connectors (id text primary key, label text not null, description text not null, status text not null, command text not null, version text, auth_state text not null, last_checked_at text, last_error text, model text, env_binding_text text not null, notes text not null, updated_at text, capability_json text)",
  "CREATE TABLE conversation_events (\n            id TEXT PRIMARY KEY,\n            thread_id TEXT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,\n            actor_id TEXT NOT NULL,\n            actor_type TEXT NOT NULL,\n            event_type TEXT NOT NULL,\n            body TEXT NOT NULL,\n            metadata_json TEXT NOT NULL DEFAULT '{}',\n            created_at TEXT NOT NULL\n          )",
  "CREATE TABLE conversation_participants (\n            thread_id TEXT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,\n            participant_id TEXT NOT NULL,\n            participant_type TEXT NOT NULL,\n            role TEXT NOT NULL DEFAULT 'member',\n            joined_at TEXT NOT NULL,\n            PRIMARY KEY (thread_id, participant_id)\n          )",
  "CREATE TABLE conversation_threads (\n            id TEXT PRIMARY KEY,\n            company_id TEXT NOT NULL,\n            title TEXT NOT NULL,\n            type TEXT NOT NULL DEFAULT 'task',\n            related_entity_type TEXT,\n            related_entity_id TEXT,\n            created_at TEXT NOT NULL,\n            updated_at TEXT NOT NULL\n          )",
  "CREATE TABLE cost_entries (id text primary key, company_id text not null, run_id text not null, task_id text, agent_id text, connector_id text not null, amount_usd real, unattributed integer not null default 0, created_at text not null, project_id TEXT)",
  "CREATE TABLE credentials (\n              connector_id TEXT PRIMARY KEY,\n              kind TEXT NOT NULL,\n              backend TEXT NOT NULL,\n              ciphertext BLOB NOT NULL,\n              display_hint TEXT NOT NULL DEFAULT '',\n              status TEXT NOT NULL DEFAULT 'active',\n              expires_at TEXT,\n              last_refreshed_at TEXT,\n              last_error TEXT,\n              created_at TEXT NOT NULL,\n              updated_at TEXT NOT NULL\n            )",
  "CREATE TABLE document_lifecycle_events (\n            id TEXT PRIMARY KEY,\n            company_id TEXT NOT NULL,\n            document_id TEXT NOT NULL,\n            hook_type TEXT NOT NULL,\n            status TEXT NOT NULL,\n            attempts INTEGER NOT NULL DEFAULT 0,\n            last_error TEXT,\n            payload_json TEXT NOT NULL DEFAULT '{}',\n            created_at TEXT NOT NULL,\n            updated_at TEXT NOT NULL,\n            completed_at TEXT\n          )",
  "CREATE TABLE document_revisions (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, document_id TEXT NOT NULL, revision_number INTEGER NOT NULL, body TEXT NOT NULL, change_summary TEXT, created_by_agent_id TEXT, created_by_user_id TEXT, created_at TEXT NOT NULL, FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE)",
  "CREATE TABLE documents (id text primary key, company_id text not null, type text not null, title text not null, content text not null default '', author_agent_id text, reviewer_agent_id text, project_id text, goal_id text, parent_doc_id text, version integer not null default 1, status text not null default 'draft', tags_json text not null default '[]', created_at text not null, updated_at text not null, latest_revision_id TEXT, source_run_id TEXT)",
  "CREATE TABLE goals (id text primary key, company_id text not null, title text not null, description text not null, parent_id text, owner_agent_id text, status text not null, created_at text not null, updated_at text not null)",
  "CREATE TABLE knowledge_base (id text primary key, company_id text not null, category text not null, topic text not null, content text not null, author_agent_id text, importance text not null default 'medium', tags_json text not null default '[]', referenced_entity_type text, referenced_entity_id text, created_at text not null, updated_at text not null, source_run_id TEXT)",
  "CREATE TABLE meetings (id text primary key, company_id text not null, type text not null, title text not null, organizer_agent_id text, participant_agent_ids text not null default '[]', scheduled_at text not null, duration_minutes integer not null default 30, agenda_json text not null default '[]', notes_json text not null default '[]', decisions_json text not null default '[]', action_items_json text not null default '[]', status text not null default 'scheduled', created_at text not null, updated_at text not null)",
  "CREATE TABLE model_capabilities (\n            provider TEXT NOT NULL,\n            model_id TEXT NOT NULL,\n            reasoning INTEGER NOT NULL,\n            coding INTEGER NOT NULL,\n            writing INTEGER NOT NULL,\n            tier TEXT NOT NULL,\n            cost_per_mtok_out REAL NOT NULL,\n            updated_at TEXT NOT NULL,\n            PRIMARY KEY (provider, model_id)\n          )",
  "CREATE TABLE projects (id text primary key, company_id text not null, goal_id text, name text not null, description text not null, lead_agent_id text, status text not null, target_date text, created_at text not null, updated_at text not null)",
  "CREATE TABLE run_events (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id TEXT NOT NULL, run_id TEXT NOT NULL, agent_id TEXT NOT NULL, seq INTEGER NOT NULL, event_type TEXT NOT NULL, stream TEXT, level TEXT, message TEXT, payload TEXT, created_at TEXT NOT NULL, FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE)",
  "CREATE TABLE \"runs\" (\n              id TEXT PRIMARY KEY,\n              company_id TEXT NOT NULL,\n              task_id TEXT,\n              agent_id TEXT NOT NULL,\n              workspace_id TEXT,\n              connector_id TEXT NOT NULL,\n              status TEXT NOT NULL,\n              summary TEXT NOT NULL,\n              error_message TEXT,\n              exit_code INTEGER,\n              signal TEXT,\n              model TEXT,\n              cost_usd REAL,\n              unattributed_cost INTEGER NOT NULL DEFAULT 0,\n              actor_type TEXT,\n              actor_id TEXT,\n              started_at TEXT,\n              finished_at TEXT,\n              log_path TEXT,\n              created_at TEXT NOT NULL,\n              updated_at TEXT NOT NULL\n            , usage_status TEXT NOT NULL DEFAULT 'pre_first_message')",
  "CREATE TABLE schema_migrations (version integer primary key, name text not null, applied_at text not null)",
  "CREATE TABLE secrets (id text primary key, company_id text not null, name text not null, description text not null, backend text not null, ciphertext blob not null, updated_at text not null, created_at text not null, unique(company_id, name))",
  "CREATE TABLE session_entries (\n              id TEXT PRIMARY KEY,\n              task_session_id TEXT NOT NULL,\n              sequence INTEGER NOT NULL,\n              kind TEXT NOT NULL,\n              role TEXT,\n              payload_json TEXT NOT NULL,\n              is_superseded INTEGER NOT NULL DEFAULT 0,\n              created_at TEXT NOT NULL\n            )",
  "CREATE TABLE settings (key text primary key, value text not null)",
  "CREATE TABLE social_accounts (id text primary key, company_id text not null references companies(id) on delete cascade, platform text not null default 'other', account_name text not null, display_name text not null default '', profile_url text not null default '', credential_secret_id text, status text not null default 'login_required', require_approval integer not null default 1, metadata_json text not null default '{}', last_used_at text, created_at text not null default (datetime('now')), updated_at text not null default (datetime('now')))",
  "CREATE TABLE sprints (id text primary key, company_id text not null, name text not null, goal text not null default '', start_date text not null, end_date text not null, status text not null default 'planning', retrospective_notes text not null default '', velocity_points integer not null default 0, completed_points integer not null default 0, created_at text not null, updated_at text not null)",
  "CREATE TABLE task_approval_links (task_id TEXT NOT NULL, approval_id TEXT NOT NULL, company_id TEXT NOT NULL, linked_by_agent_id TEXT, created_at TEXT NOT NULL, PRIMARY KEY (task_id, approval_id), FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE, FOREIGN KEY (approval_id) REFERENCES approvals(id) ON DELETE CASCADE)",
  "CREATE TABLE task_comments (id text primary key, company_id text not null, task_id text not null, author_agent_id text, author_name text not null, body text not null, created_at text not null)",
  "CREATE TABLE task_documents (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, task_id TEXT NOT NULL, document_id TEXT NOT NULL, key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE, FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE)",
  "CREATE TABLE \"task_sessions\" (\n                id TEXT PRIMARY KEY,\n                company_id TEXT NOT NULL,\n                agent_id TEXT NOT NULL,\n                adapter_type TEXT NOT NULL,\n                last_run_id TEXT,\n                last_error TEXT,\n                run_count INTEGER NOT NULL DEFAULT 0,\n                total_input_tokens INTEGER NOT NULL DEFAULT 0,\n                total_output_tokens INTEGER NOT NULL DEFAULT 0,\n                rotated_at TEXT,\n                rotation_reason TEXT,\n                handoff_markdown TEXT,\n                created_at TEXT NOT NULL,\n                updated_at TEXT NOT NULL\n              )",
  "CREATE TABLE \"tasks\" (\n                id TEXT PRIMARY KEY,\n                company_id TEXT NOT NULL,\n                project_id TEXT,\n                goal_id TEXT,\n                parent_id TEXT,\n                title TEXT NOT NULL,\n                description TEXT NOT NULL,\n                assignee_agent_id TEXT,\n                workspace_id TEXT,\n                status TEXT NOT NULL,\n                priority TEXT NOT NULL,\n                active_run_id TEXT,\n                cost_usd REAL NOT NULL DEFAULT 0,\n                task_type TEXT NOT NULL DEFAULT 'general',\n                requires_user_review INTEGER NOT NULL DEFAULT 0,\n                retry_count INTEGER NOT NULL DEFAULT 0,\n                last_failure_at TEXT,\n                checkout_run_id TEXT,\n                execution_locked_at TEXT,\n                started_at TEXT,\n                completed_at TEXT,\n                cancelled_at TEXT,\n                created_at TEXT NOT NULL,\n                updated_at TEXT NOT NULL\n              , requires_filesystem INTEGER NOT NULL DEFAULT 0, active_session_id text)",
  "CREATE TABLE thread_subscriptions (\n    thread_id TEXT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,\n    subscriber_id TEXT NOT NULL,\n    subscriber_type TEXT NOT NULL,\n    notify_on TEXT NOT NULL DEFAULT 'all',\n    subscribed_at TEXT NOT NULL,\n    PRIMARY KEY (thread_id, subscriber_id)\n  )",
  "CREATE TABLE thread_wait_states (\n            id TEXT PRIMARY KEY,\n            thread_id TEXT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,\n            company_id TEXT NOT NULL,\n            waiting_for TEXT NOT NULL,\n            related_approval_id TEXT,\n            reason TEXT NOT NULL,\n            created_at TEXT NOT NULL,\n            resolved_at TEXT\n          )",
  "CREATE TABLE wakeup_requests (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, agent_id TEXT NOT NULL, source TEXT NOT NULL, trigger_detail TEXT, reason TEXT, payload TEXT, status TEXT NOT NULL DEFAULT 'queued', coalesced_count INTEGER NOT NULL DEFAULT 0, requested_by_actor_type TEXT, requested_by_actor_id TEXT, idempotency_key TEXT, run_id TEXT, requested_at TEXT NOT NULL, claimed_at TEXT, finished_at TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, context_snapshot TEXT)",
  "CREATE TABLE \"work_products\" (\n              id TEXT PRIMARY KEY,\n              company_id TEXT NOT NULL,\n              project_id TEXT,\n              task_id TEXT,\n              type TEXT NOT NULL,\n              provider TEXT NOT NULL,\n              external_id TEXT,\n              title TEXT NOT NULL,\n              url TEXT,\n              status TEXT NOT NULL DEFAULT 'active',\n              review_state TEXT NOT NULL DEFAULT 'none',\n              is_primary INTEGER NOT NULL DEFAULT 0,\n              summary TEXT,\n              metadata_json TEXT,\n              created_by_run_id TEXT,\n              created_at TEXT NOT NULL,\n              updated_at TEXT NOT NULL, workspace_id TEXT, last_touched_by_run_id TEXT,\n              FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE\n            )",
  "CREATE TABLE workflow_pipelines (id text primary key, company_id text not null, name text not null, description text not null default '', steps_json text not null default '[]', trigger_type text not null, trigger_config_json text not null default '{}', status text not null default 'draft', current_step_index integer not null default 0, run_count integer not null default 0, last_run_at text, created_at text not null, updated_at text not null)",
  "CREATE TABLE workspaces (id text primary key, company_id text not null, name text not null, local_path text not null, repo_url text not null, repo_ref text not null, project_id text, state text not null, is_primary integer not null default 0, created_at text not null, updated_at text not null, lock_holder_run_id text, lock_acquired_at text)",
] as const;

export const BASELINE_INDEX_SQL = [
  "CREATE INDEX idx_activity_company on activity(company_id)",
  "CREATE INDEX idx_activity_company_actor_action ON activity(company_id, actor, action)",
  "CREATE INDEX idx_activity_company_created_at on activity(company_id, created_at desc)",
  "CREATE INDEX idx_agent_config_rev_agent ON agent_config_revisions(company_id, agent_id, created_at)",
  "CREATE UNIQUE INDEX idx_agent_config_rev_num ON agent_config_revisions(agent_id, revision_number)",
  "CREATE INDEX idx_agent_message_mentions_agent\n          ON agent_message_mentions(company_id, agent_id, created_at)\n        ",
  "CREATE INDEX idx_agent_message_mentions_message\n          ON agent_message_mentions(message_id)\n        ",
  "CREATE INDEX idx_agent_message_projections_session\n          ON agent_message_projections(session_id, projected_at)\n        ",
  "CREATE INDEX idx_agent_message_reads_agent on agent_message_reads(agent_id)",
  "CREATE INDEX idx_agent_messages_channel on agent_messages(channel)",
  "CREATE INDEX idx_agent_messages_company on agent_messages(company_id)",
  "CREATE INDEX idx_agent_messages_company_created_at on agent_messages(company_id, created_at desc)",
  "CREATE INDEX idx_agent_messages_from on agent_messages(from_agent_id)",
  "CREATE INDEX idx_agent_messages_to on agent_messages(to_agent_id)",
  "CREATE INDEX idx_agent_skill_assignments_skill ON agent_skill_assignments(skill_id)",
  "CREATE INDEX idx_agents_company on agents(company_id)",
  "CREATE INDEX idx_agents_company_status on agents(company_id, status)",
  "CREATE INDEX idx_agents_department on agents(company_id, department)",
  "CREATE INDEX idx_agents_reports_to on agents(reports_to)",
  "CREATE INDEX idx_agents_session_id ON agents(session_id)",
  "CREATE INDEX idx_approval_comments_approval ON approval_comments(approval_id, created_at)",
  "CREATE INDEX idx_approvals_company on approvals(company_id)",
  "CREATE INDEX idx_approvals_company_created_at ON approvals(company_id, created_at DESC)",
  "CREATE INDEX idx_approvals_company_state on approvals(company_id, state)",
  "CREATE INDEX idx_approvals_company_state_type ON approvals(company_id, state, type)",
  "CREATE INDEX idx_approvals_related_task ON approvals(related_task_id)",
  "CREATE INDEX idx_automation_log_company on automation_log(company_id)",
  "CREATE INDEX idx_automation_rules_company on automation_rules(company_id)",
  "CREATE INDEX idx_automation_rules_company_status on automation_rules(company_id, status)",
  "CREATE INDEX idx_automation_rules_trigger on automation_rules(trigger)",
  "CREATE INDEX idx_browser_actions_account on browser_actions(social_account_id)",
  "CREATE INDEX idx_browser_actions_company on browser_actions(company_id)",
  "CREATE INDEX idx_budget_incidents_company_scope ON budget_incidents(company_id, scope_type, scope_id, status)",
  "CREATE INDEX idx_budget_incidents_company_status ON budget_incidents(company_id, status)",
  "CREATE INDEX idx_budget_incidents_policy ON budget_incidents(policy_id, window_start, threshold_type)",
  "CREATE INDEX idx_budget_policies_company_scope ON budget_policies(company_id, scope_type, scope_id, is_active)",
  "CREATE UNIQUE INDEX idx_budget_policies_unique ON budget_policies(company_id, scope_type, scope_id, metric, window_kind)",
  "CREATE INDEX idx_comments_company on task_comments(company_id)",
  "CREATE INDEX idx_comments_task on task_comments(task_id)",
  "CREATE UNIQUE INDEX idx_company_skills_company_key ON company_skills(company_id, key)",
  "CREATE INDEX idx_company_skills_company_name ON company_skills(company_id, name)",
  "CREATE INDEX idx_connector_model_pool_company\n              ON connector_model_pool_settings(company_id)",
  "CREATE INDEX idx_conv_events_thread ON conversation_events(thread_id, created_at)",
  "CREATE INDEX idx_conv_participants_participant ON conversation_participants(participant_id)",
  "CREATE INDEX idx_conv_threads_company ON conversation_threads(company_id)",
  "CREATE INDEX idx_conv_threads_entity ON conversation_threads(related_entity_type, related_entity_id)",
  "CREATE INDEX idx_cost_entries_agent_created_at ON cost_entries(agent_id, created_at DESC)",
  "CREATE INDEX idx_cost_entries_company on cost_entries(company_id)",
  "CREATE INDEX idx_cost_entries_company_created_at on cost_entries(company_id, created_at desc)",
  "CREATE INDEX idx_cost_entries_project ON cost_entries(project_id)",
  "CREATE INDEX idx_cost_entries_run on cost_entries(run_id)",
  "CREATE INDEX idx_credentials_status ON credentials(status)",
  "CREATE INDEX idx_doc_rev_company ON document_revisions(company_id, document_id, created_at)",
  "CREATE UNIQUE INDEX idx_doc_rev_doc_num ON document_revisions(document_id, revision_number)",
  "CREATE INDEX idx_document_lifecycle_events_company\n          ON document_lifecycle_events(company_id, status, updated_at)\n        ",
  "CREATE INDEX idx_document_lifecycle_events_document\n          ON document_lifecycle_events(document_id, hook_type)\n        ",
  "CREATE INDEX idx_documents_author on documents(author_agent_id)",
  "CREATE INDEX idx_documents_company on documents(company_id)",
  "CREATE INDEX idx_documents_company_updated_at ON documents(company_id, updated_at DESC)",
  "CREATE INDEX idx_documents_project on documents(project_id)",
  "CREATE INDEX idx_goals_company on goals(company_id)",
  "CREATE INDEX idx_knowledge_category on knowledge_base(category)",
  "CREATE INDEX idx_knowledge_company on knowledge_base(company_id)",
  "CREATE INDEX idx_meetings_company on meetings(company_id)",
  "CREATE INDEX idx_meetings_company_scheduled_at ON meetings(company_id, scheduled_at DESC)",
  "CREATE INDEX idx_meetings_organizer on meetings(organizer_agent_id)",
  "CREATE INDEX idx_messages_channel on agent_messages(channel, channel_target_id)",
  "CREATE INDEX idx_messages_company on agent_messages(company_id)",
  "CREATE INDEX idx_model_capabilities_tier ON model_capabilities(tier)",
  "CREATE INDEX idx_projects_company on projects(company_id)",
  "CREATE INDEX idx_run_events_company ON run_events(company_id, run_id)",
  "CREATE INDEX idx_run_events_run ON run_events(run_id, seq)",
  "CREATE UNIQUE INDEX idx_run_events_run_seq_unique ON run_events(run_id, seq)",
  "CREATE INDEX idx_runs_agent ON runs(agent_id)",
  "CREATE INDEX idx_runs_agent_created_at ON runs(agent_id, created_at DESC)",
  "CREATE INDEX idx_runs_company ON runs(company_id)",
  "CREATE INDEX idx_runs_company_created_at ON runs(company_id, created_at DESC)",
  "CREATE INDEX idx_runs_company_status ON runs(company_id, status)",
  "CREATE INDEX idx_runs_task ON runs(task_id)",
  "CREATE INDEX idx_secrets_company on secrets(company_id)",
  "CREATE INDEX idx_session_entries_active ON session_entries(task_session_id, is_superseded, sequence)",
  "CREATE INDEX idx_session_entries_session ON session_entries(task_session_id, sequence)",
  "CREATE INDEX idx_social_accounts_company on social_accounts(company_id)",
  "CREATE INDEX idx_sprints_company on sprints(company_id)",
  "CREATE INDEX idx_sprints_company_start_date ON sprints(company_id, start_date DESC)",
  "CREATE INDEX idx_task_approval_links_approval ON task_approval_links(approval_id)",
  "CREATE INDEX idx_task_approval_links_task ON task_approval_links(task_id)",
  "CREATE UNIQUE INDEX idx_task_documents_doc ON task_documents(document_id)",
  "CREATE UNIQUE INDEX idx_task_documents_task_key ON task_documents(company_id, task_id, key)",
  "CREATE INDEX idx_task_sessions_company_agent\n                ON task_sessions(company_id, agent_id, updated_at)",
  "CREATE INDEX idx_task_sessions_lookup\n                ON task_sessions(company_id, agent_id, adapter_type)",
  "CREATE INDEX idx_tasks_assignee ON tasks(assignee_agent_id)",
  "CREATE INDEX idx_tasks_company ON tasks(company_id)",
  "CREATE INDEX idx_tasks_company_status ON tasks(company_id, status)",
  "CREATE INDEX idx_tasks_project ON tasks(project_id)",
  "CREATE INDEX idx_thread_subs_subscriber ON thread_subscriptions(subscriber_id)",
  "CREATE INDEX idx_thread_wait_company ON thread_wait_states(company_id, resolved_at)",
  "CREATE INDEX idx_thread_wait_thread ON thread_wait_states(thread_id)",
  "CREATE INDEX idx_wakeup_requests_agent ON wakeup_requests(agent_id, company_id, status)",
  "CREATE INDEX idx_wakeup_requests_agent_requested ON wakeup_requests(agent_id, requested_at)",
  "CREATE INDEX idx_wakeup_requests_company_agent_status ON wakeup_requests(company_id, agent_id, status)",
  "CREATE INDEX idx_wakeup_requests_company_requested ON wakeup_requests(company_id, requested_at)",
  "CREATE UNIQUE INDEX idx_work_products_identity\n          ON work_products(company_id, workspace_id, provider, external_id)\n          WHERE workspace_id IS NOT NULL AND external_id IS NOT NULL\n        ",
  "CREATE INDEX idx_work_products_last_touched\n          ON work_products(company_id, last_touched_by_run_id)\n        ",
  "CREATE UNIQUE INDEX idx_work_products_primary_active\n          ON work_products(company_id, task_id, type)\n          WHERE task_id IS NOT NULL\n            AND is_primary = 1\n            AND status <> 'archived'",
  "CREATE INDEX idx_work_products_task\n              ON work_products(company_id, task_id, type)",
  "CREATE INDEX idx_work_products_updated\n              ON work_products(company_id, updated_at)",
  "CREATE INDEX idx_workflows_company on workflow_pipelines(company_id)",
  "CREATE INDEX idx_workspaces_company on workspaces(company_id)",
  "CREATE UNIQUE INDEX secrets_company_name_idx on secrets(company_id, name)",
] as const;

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll("\"", "\"\"")}"`;
}

function parseSchemaName(sql: string, prefix: RegExp, kind: string): string {
  const match = prefix.exec(sql);
  if (!match) throw new Error(`Cannot parse baseline ${kind} name from SQL: ${sql}`);
  return match[1] ?? match[2]!;
}

export function parseBaselineTableName(sql: string): string {
  return parseSchemaName(
    sql,
    /^CREATE TABLE(?: IF NOT EXISTS)? (?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/,
    "table",
  );
}

export function parseBaselineIndexName(sql: string): string {
  return parseSchemaName(
    sql,
    /^CREATE (?:UNIQUE )?INDEX(?: IF NOT EXISTS)? (?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/,
    "index",
  );
}

export function normalizeSchemaSql(sql: string): string {
  return sql
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/^CREATE TABLE "([^"]+)"/, "CREATE TABLE $1")
    .replace(/^CREATE INDEX "([^"]+)"/, "CREATE INDEX $1")
    .replace(/^CREATE UNIQUE INDEX "([^"]+)"/, "CREATE UNIQUE INDEX $1")
    .trim();
}

function ifNotExists(sql: string): string {
  return sql
    .replace(/^CREATE TABLE /, "CREATE TABLE IF NOT EXISTS ")
    .replace(/^CREATE INDEX /, "CREATE INDEX IF NOT EXISTS ")
    .replace(/^CREATE UNIQUE INDEX /, "CREATE UNIQUE INDEX IF NOT EXISTS ");
}

export function installBaselineTables(db: DatabaseSync): void {
  db.exec(BASELINE_TABLE_SQL.map(ifNotExists).join(";\n"));
}

export function installBaselineIndexes(db: DatabaseSync): void {
  db.exec(BASELINE_INDEX_SQL.map(ifNotExists).join(";\n"));
}

export function installCanonicalBaselineIndexes(db: DatabaseSync): void {
  for (const sql of BASELINE_INDEX_SQL) {
    db.exec(`DROP INDEX IF EXISTS ${quoteIdentifier(parseBaselineIndexName(sql))}`);
  }
  db.exec(BASELINE_INDEX_SQL.join(";\n"));
}

export function installBaselineSchema(db: DatabaseSync): void {
  installBaselineTables(db);
  installBaselineIndexes(db);
}

export function assertBaselineSchema(db: DatabaseSync): void {
  assertSchemaEntries(
    db,
    "table",
    BASELINE_TABLE_SQL.map((sql) => [parseBaselineTableName(sql), normalizeSchemaSql(sql)] as const),
  );
  assertSchemaEntries(
    db,
    "index",
    BASELINE_INDEX_SQL.map((sql) => [parseBaselineIndexName(sql), normalizeSchemaSql(sql)] as const),
  );
}

function assertSchemaEntries(
  db: DatabaseSync,
  type: "table" | "index",
  expectedEntries: ReadonlyArray<readonly [string, string]>,
): void {
  const selectSql = db.prepare("select sql from sqlite_master where type = ? and name = ?");
  for (const [name, expectedSql] of expectedEntries) {
    const row = selectSql.get(type, name) as { sql: string | null } | undefined;
    const actualSql = row?.sql ? normalizeSchemaSql(row.sql) : null;
    if (actualSql !== expectedSql) {
      throw new Error(`Baseline v56 ${type} drift for ${name}: expected ${expectedSql}; actual ${actualSql ?? "missing"}`);
    }
  }
}
