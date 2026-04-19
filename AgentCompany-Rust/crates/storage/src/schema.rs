use anyhow::Result;
use domain::CONNECTOR_SEEDS;
use rusqlite::{Connection, params};
use support::time::now_iso;

pub fn initialize(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        create table if not exists settings (
            key text primary key,
            value text not null
        );

        create table if not exists companies (
            id text primary key,
            name text not null,
            description text not null default '',
            status text not null default 'active',
            auto_approve_hires integer not null default 0,
            review_deliverables integer not null default 0,
            execution_mode text not null default 'ai_ceo',
            created_at text not null,
            updated_at text not null
        );

        create table if not exists connectors (
            id text primary key,
            label text not null,
            description text not null,
            status text not null default 'not_installed',
            command text not null default '',
            version text null,
            auth_state text not null default 'unknown',
            last_checked_at text null,
            last_error text null,
            model text null,
            env_binding_text text not null default '',
            notes text not null default '',
            updated_at text not null
        );

        create table if not exists workspaces (
            id text primary key,
            company_id text not null,
            name text not null,
            local_path text not null,
            repo_url text not null default '',
            repo_ref text not null default '',
            project_id text null,
            state text not null default 'ready',
            is_primary integer not null default 0,
            lock_holder_run_id text null,
            lock_acquired_at text null,
            created_at text not null,
            updated_at text not null,
            foreign key(company_id) references companies(id) on delete cascade
        );

        create table if not exists agents (
            id text primary key,
            company_id text not null,
            name text not null,
            role text not null default '',
            title text not null default '',
            department text null,
            status text not null default 'idle',
            reports_to text null,
            connector_id text not null default 'anthropic',
            workspace_id text null,
            model text null,
            capabilities text not null default '[]',
            budget_monthly_usd real not null default 0,
            spent_monthly_usd real not null default 0,
            metadata_json text not null default '{}',
            heartbeat_enabled integer not null default 0,
            heartbeat_interval_sec integer not null default 0,
            last_heartbeat_at text null,
            created_at text not null,
            updated_at text not null,
            foreign key(company_id) references companies(id) on delete cascade
        );

        create table if not exists goals (
            id text primary key,
            company_id text not null,
            title text not null,
            description text not null default '',
            parent_id text null,
            owner_agent_id text null,
            status text not null default 'planned',
            created_at text not null,
            updated_at text not null,
            foreign key(company_id) references companies(id) on delete cascade
        );

        create table if not exists projects (
            id text primary key,
            company_id text not null,
            goal_id text null,
            name text not null,
            description text not null default '',
            lead_agent_id text null,
            status text not null default 'planned',
            target_date text null,
            created_at text not null,
            updated_at text not null,
            foreign key(company_id) references companies(id) on delete cascade
        );

        create table if not exists tasks (
            id text primary key,
            company_id text not null,
            project_id text null,
            goal_id text null,
            parent_id text null,
            title text not null,
            description text not null default '',
            assignee_agent_id text null,
            workspace_id text null,
            status text not null default 'todo',
            priority text not null default 'medium',
            active_run_id text null,
            cost_usd real not null default 0,
            task_type text null,
            requires_user_review integer not null default 0,
            started_at text null,
            completed_at text null,
            cancelled_at text null,
            created_at text not null,
            updated_at text not null,
            foreign key(company_id) references companies(id) on delete cascade
        );

        create table if not exists approvals (
            id text primary key,
            company_id text not null,
            related_task_id text null,
            requested_by_agent_id text null,
            related_agent_id text null,
            type text not null,
            payload_summary text not null default '',
            impact_summary text not null default '',
            payload_json text null,
            decision_note text not null default '',
            state text not null default 'pending',
            created_at text not null,
            updated_at text not null,
            foreign key(company_id) references companies(id) on delete cascade
        );

        create table if not exists runs (
            id text primary key,
            company_id text not null,
            task_id text null,
            agent_id text not null,
            workspace_id text null,
            connector_id text not null,
            status text not null default 'queued',
            summary text not null default '',
            error_message text null,
            exit_code integer null,
            signal text null,
            model text null,
            cost_usd real null,
            unattributed_cost integer not null default 0,
            started_at text null,
            finished_at text null,
            log_path text null,
            created_at text not null,
            updated_at text not null,
            foreign key(company_id) references companies(id) on delete cascade
        );

        create table if not exists activity (
            id text primary key,
            company_id text not null,
            actor text not null,
            action text not null,
            entity_type text not null,
            entity_id text not null,
            detail text not null,
            created_at text not null,
            foreign key(company_id) references companies(id) on delete cascade
        );

        create table if not exists run_events (
            id text primary key,
            company_id text not null,
            run_id text not null,
            event_kind text not null,
            title text not null,
            detail text not null default '',
            created_at text not null,
            foreign key(company_id) references companies(id) on delete cascade,
            foreign key(run_id) references runs(id) on delete cascade
        );

        create table if not exists artifacts (
            id text primary key,
            company_id text not null,
            run_id text not null,
            provider text not null,
            external_id text not null,
            title text not null,
            metadata_json text not null default '{}',
            created_at text not null,
            foreign key(company_id) references companies(id) on delete cascade,
            foreign key(run_id) references runs(id) on delete cascade
        );

        create table if not exists agent_messages (
            id text primary key,
            company_id text not null,
            from_agent_id text not null,
            to_agent_id text null,
            sender_kind text not null default 'human',
            channel text not null default 'company',
            channel_target_id text null,
            subject text not null,
            body text not null,
            priority text not null default 'normal',
            read_at text null,
            parent_message_id text null,
            attachments_json text not null default '[]',
            created_at text not null,
            foreign key(company_id) references companies(id) on delete cascade
        );

        create table if not exists agent_message_reads (
            message_id text not null,
            agent_id text not null,
            read_at text not null,
            primary key(message_id, agent_id)
        );

        create table if not exists documents (
            id text primary key,
            company_id text not null,
            type text not null,
            title text not null,
            content text not null default '',
            author_agent_id text null,
            reviewer_agent_id text null,
            project_id text null,
            goal_id text null,
            parent_doc_id text null,
            version integer not null default 1,
            status text not null default 'draft',
            tags_json text not null default '[]',
            latest_revision_id text null,
            source_run_id text null,
            created_at text not null,
            updated_at text not null,
            foreign key(company_id) references companies(id) on delete cascade
        );

        create table if not exists document_revisions (
            id text primary key,
            company_id text not null,
            document_id text not null,
            revision_number integer not null,
            body text not null,
            change_summary text null,
            created_by_agent_id text null,
            created_by_user_id text null,
            created_at text not null,
            foreign key(company_id) references companies(id) on delete cascade,
            foreign key(document_id) references documents(id) on delete cascade
        );

        create table if not exists conversation_threads (
            id text primary key,
            company_id text not null,
            title text not null,
            type text not null,
            related_entity_type text null,
            related_entity_id text null,
            created_at text not null,
            updated_at text not null,
            foreign key(company_id) references companies(id) on delete cascade
        );

        create table if not exists conversation_events (
            id text primary key,
            thread_id text not null,
            actor_id text not null,
            actor_type text not null,
            event_type text not null,
            body text not null,
            metadata_json text not null default '{}',
            created_at text not null,
            foreign key(thread_id) references conversation_threads(id) on delete cascade
        );

        create table if not exists conversation_participants (
            thread_id text not null,
            participant_id text not null,
            participant_type text not null,
            role text not null default 'member',
            joined_at text not null,
            primary key(thread_id, participant_id)
        );

        create table if not exists thread_wait_states (
            id text primary key,
            thread_id text not null,
            company_id text not null,
            waiting_for text not null,
            related_approval_id text null,
            reason text not null,
            created_at text not null,
            resolved_at text null,
            foreign key(thread_id) references conversation_threads(id) on delete cascade,
            foreign key(company_id) references companies(id) on delete cascade
        );

        create table if not exists work_products (
            id text primary key,
            company_id text not null,
            project_id text null,
            task_id text null,
            type text not null,
            provider text not null,
            external_id text null,
            title text not null,
            url text null,
            status text not null default 'active',
            review_state text not null default 'none',
            is_primary integer not null default 0,
            summary text null,
            metadata_json text null,
            created_by_run_id text null,
            created_at text not null,
            updated_at text not null,
            foreign key(company_id) references companies(id) on delete cascade
        );
        "#,
    )?;
    seed_connectors(conn)?;
    Ok(())
}

fn seed_connectors(conn: &Connection) -> Result<()> {
    let updated_at = now_iso()?;
    let mut statement = conn.prepare(
        r#"
        insert into connectors (
            id, label, description, status, command, version, auth_state,
            last_checked_at, last_error, model, env_binding_text, notes, updated_at
        )
        values (?1, ?2, ?3, 'not_installed', '', null, 'unknown', null, null, null, '', '', ?4)
        on conflict(id) do update set
            label = excluded.label,
            description = excluded.description,
            updated_at = excluded.updated_at
        "#,
    )?;

    for connector in CONNECTOR_SEEDS {
        statement.execute(params![
            connector.id,
            connector.label,
            connector.description,
            updated_at
        ])?;
    }
    Ok(())
}
