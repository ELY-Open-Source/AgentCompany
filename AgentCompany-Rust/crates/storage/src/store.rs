use crate::schema;
use anyhow::{Context, Result, anyhow};
use domain::{
    Activity, Agent, AgentMessage, Approval, ApprovalState, Company, Connector, Document, Goal,
    ProfileSnapshot, Project, Run, Task, Workspace,
};
use rusqlite::{Connection, OptionalExtension, params};
use std::{
    env,
    path::{Path, PathBuf},
    time::Duration,
};
use support::{
    paths::{ensure_profile_dir, profile_db_path},
    time::now_iso,
};
use uuid::Uuid;

const BOARD_READER_ID: &str = "__board__";

#[derive(Clone, Debug, Default)]
pub struct NewCompanyInput {
    pub name: String,
    pub description: String,
    pub workspace_path: String,
    pub execution_mode: String,
}

pub struct ProfileStore {
    profile_dir: PathBuf,
    db_path: PathBuf,
    conn: Connection,
}

impl ProfileStore {
    pub fn open(profile_dir: impl AsRef<Path>) -> Result<Self> {
        let profile_dir = profile_dir.as_ref().to_path_buf();
        ensure_profile_dir(&profile_dir)?;
        let db_path = profile_db_path(&profile_dir);
        let conn = Connection::open(&db_path)
            .with_context(|| format!("failed to open SQLite database at {}", db_path.display()))?;
        conn.busy_timeout(Duration::from_secs(5))?;
        conn.execute_batch("pragma foreign_keys = on; pragma journal_mode = wal;")?;
        schema::initialize(&conn)?;
        Ok(Self {
            profile_dir,
            db_path,
            conn,
        })
    }

    pub fn profile_dir(&self) -> &Path {
        &self.profile_dir
    }

    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    pub fn snapshot(&self) -> Result<ProfileSnapshot> {
        let companies = self.query_companies()?;
        let preferred_company_id = self.setting("current_company_id")?;
        let current_company_id = preferred_company_id
            .filter(|value| !value.is_empty())
            .or_else(|| companies.first().map(|company| company.id.clone()));

        let current_company_key = current_company_id.clone();
        let current_ref = current_company_key.as_deref();
        Ok(ProfileSnapshot {
            current_company_id,
            profile_path: self.profile_dir.display().to_string(),
            theme: self
                .setting("theme")?
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "system".to_string()),
            locale: self
                .setting("locale")?
                .filter(|value| !value.is_empty())
                .unwrap_or_else(default_locale),
            companies,
            connectors: self.query_connectors()?,
            workspaces: self.query_workspaces(current_ref)?,
            agents: self.query_agents(current_ref)?,
            goals: self.query_goals(current_ref)?,
            projects: self.query_projects(current_ref)?,
            tasks: self.query_tasks(current_ref)?,
            approvals: self.query_approvals(current_ref)?,
            runs: self.query_runs(current_ref)?,
            activity: self.query_activity(current_ref)?,
            agent_messages: self.query_messages(current_ref)?,
            documents: self.query_documents(current_ref)?,
        })
    }

    pub fn create_company(&mut self, input: NewCompanyInput) -> Result<String> {
        let name = input.name.trim();
        if name.len() < 2 {
            return Err(anyhow!("company name must be at least 2 characters"));
        }

        let company_id = Uuid::new_v4().to_string();
        let ts = now_iso()?;
        self.conn.execute(
            r#"
            insert into companies (
                id, name, description, status, auto_approve_hires,
                review_deliverables, execution_mode, created_at, updated_at
            ) values (?1, ?2, ?3, 'active', 0, 0, ?4, ?5, ?5)
            "#,
            params![
                company_id,
                name,
                input.description.trim(),
                normalized_execution_mode(&input.execution_mode),
                ts
            ],
        )?;
        self.set_current_company(&company_id)?;

        if !input.workspace_path.trim().is_empty() {
            self.conn.execute(
                r#"
                insert into workspaces (
                    id, company_id, name, local_path, repo_url, repo_ref,
                    project_id, state, is_primary, created_at, updated_at
                ) values (?1, ?2, ?3, ?4, '', '', null, 'ready', 1, ?5, ?5)
                "#,
                params![
                    Uuid::new_v4().to_string(),
                    company_id,
                    "Primary Workspace",
                    input.workspace_path.trim(),
                    ts
                ],
            )?;
        }

        self.add_activity(
            &company_id,
            BOARD_READER_ID,
            "created_company",
            "companies",
            &company_id,
            name,
        )?;
        Ok(company_id)
    }

    pub fn set_current_company(&mut self, company_id: &str) -> Result<()> {
        self.conn.execute(
            "insert into settings (key, value) values ('current_company_id', ?1) on conflict(key) do update set value = excluded.value",
            params![company_id],
        )?;
        Ok(())
    }

    pub fn update_theme(&mut self, theme: &str) -> Result<()> {
        let normalized = match theme {
            "system" | "light" | "dark" => theme,
            _ => return Err(anyhow!("unsupported theme value: {theme}")),
        };
        self.conn.execute(
            "insert into settings (key, value) values ('theme', ?1) on conflict(key) do update set value = excluded.value",
            params![normalized],
        )?;
        Ok(())
    }

    pub fn update_locale(&mut self, locale: &str) -> Result<()> {
        let normalized = match locale {
            "en" | "zh" => locale,
            _ => return Err(anyhow!("unsupported locale value: {locale}")),
        };
        self.conn.execute(
            "insert into settings (key, value) values ('locale', ?1) on conflict(key) do update set value = excluded.value",
            params![normalized],
        )?;
        Ok(())
    }

    pub fn update_execution_mode(&mut self, company_id: &str, execution_mode: &str) -> Result<()> {
        let normalized = normalized_execution_mode(execution_mode);
        let ts = now_iso()?;
        self.conn.execute(
            "update companies set execution_mode = ?1, auto_approve_hires = ?2, review_deliverables = ?3, updated_at = ?4 where id = ?5",
            params![
                normalized,
                if normalized == "ai_ceo" { 1 } else { 0 },
                if normalized == "ai_cofounder" { 1 } else { 0 },
                ts,
                company_id
            ],
        )?;
        self.add_activity(
            company_id,
            BOARD_READER_ID,
            "updated_execution_mode",
            "companies",
            company_id,
            normalized,
        )?;
        Ok(())
    }

    pub fn set_primary_workspace(&mut self, company_id: &str, workspace_id: &str) -> Result<()> {
        let ts = now_iso()?;
        let tx = self.conn.transaction()?;
        let belongs = tx.query_row(
            "select count(1) from workspaces where id = ?1 and company_id = ?2",
            params![workspace_id, company_id],
            |row| row.get::<_, i64>(0),
        )?;
        if belongs == 0 {
            return Err(anyhow!("workspace {workspace_id} was not found"));
        }
        tx.execute(
            "update workspaces set is_primary = 0, updated_at = ?1 where company_id = ?2",
            params![ts, company_id],
        )?;
        tx.execute(
            "update workspaces set is_primary = 1, updated_at = ?1 where id = ?2 and company_id = ?3",
            params![ts, workspace_id, company_id],
        )?;
        tx.commit()?;
        self.add_activity(
            company_id,
            BOARD_READER_ID,
            "updated_primary_workspace",
            "workspaces",
            workspace_id,
            "primary workspace changed",
        )?;
        Ok(())
    }

    pub fn decide_approval(
        &mut self,
        company_id: &str,
        approval_id: &str,
        state: ApprovalState,
        note: &str,
    ) -> Result<()> {
        let ts = now_iso()?;
        let tx = self.conn.transaction()?;
        let approval = tx
            .query_row(
                "select type, related_agent_id from approvals where id = ?1 and company_id = ?2",
                params![approval_id, company_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()?
            .ok_or_else(|| anyhow!("approval {approval_id} was not found"))?;

        tx.execute(
            "update approvals set state = ?1, decision_note = ?2, updated_at = ?3 where id = ?4 and company_id = ?5",
            params![state.as_str(), note.trim(), ts, approval_id, company_id],
        )?;

        if approval.0 == "hire_agent"
            && let Some(agent_id) = approval.1
        {
            let next_status = match state {
                ApprovalState::Approved => Some("idle"),
                ApprovalState::Rejected => Some("terminated"),
                _ => None,
            };
            if let Some(status) = next_status {
                tx.execute(
                    "update agents set status = ?1, updated_at = ?2 where id = ?3 and company_id = ?4",
                    params![status, ts, agent_id, company_id],
                )?;
            }
        }

        tx.commit()?;
        self.add_activity(
            company_id,
            BOARD_READER_ID,
            format!("approval_{}", state.as_str()).as_str(),
            "approvals",
            approval_id,
            note.trim(),
        )?;
        Ok(())
    }

    pub fn mark_message_read(&mut self, company_id: &str, message_id: &str) -> Result<()> {
        let ts = now_iso()?;
        self.conn.execute(
            r#"
            insert into agent_message_reads (message_id, agent_id, read_at)
            select id, ?1, ?2 from agent_messages where id = ?3 and company_id = ?4
            on conflict(message_id, agent_id) do update set read_at = excluded.read_at
            "#,
            params![BOARD_READER_ID, ts, message_id, company_id],
        )?;
        Ok(())
    }

    pub fn send_board_message(&mut self, company_id: &str, body: &str) -> Result<String> {
        let body = body.trim();
        if body.is_empty() {
            return Err(anyhow!("message body cannot be empty"));
        }

        let message_id = Uuid::new_v4().to_string();
        let ts = now_iso()?;
        self.conn.execute(
            r#"
            insert into agent_messages (
                id, company_id, from_agent_id, to_agent_id, sender_kind, channel,
                channel_target_id, subject, body, priority, read_at, parent_message_id,
                attachments_json, created_at
            ) values (?1, ?2, ?3, null, 'human', 'company', null, ?4, ?5, 'normal', null, null, '[]', ?6)
            "#,
            params![message_id, company_id, BOARD_READER_ID, subject_for(body), body, ts],
        )?;
        self.add_activity(
            company_id,
            BOARD_READER_ID,
            "sent_message",
            "agent_messages",
            &message_id,
            body,
        )?;
        Ok(message_id)
    }

    pub fn create_document(
        &mut self,
        company_id: &str,
        title: &str,
        content: &str,
    ) -> Result<String> {
        let title = title.trim();
        if title.is_empty() {
            return Err(anyhow!("document title cannot be empty"));
        }

        let document_id = Uuid::new_v4().to_string();
        let ts = now_iso()?;
        self.conn.execute(
            r#"
            insert into documents (
                id, company_id, type, title, content, author_agent_id, reviewer_agent_id,
                project_id, goal_id, parent_doc_id, version, status, tags_json,
                latest_revision_id, source_run_id, created_at, updated_at
            ) values (?1, ?2, 'status_report', ?3, ?4, null, null, null, null, null, 1, 'draft', '[]', null, null, ?5, ?5)
            "#,
            params![document_id, company_id, title, content.trim(), ts],
        )?;
        self.add_activity(
            company_id,
            BOARD_READER_ID,
            "created_document",
            "documents",
            &document_id,
            title,
        )?;
        Ok(document_id)
    }

    fn add_activity(
        &self,
        company_id: &str,
        actor: &str,
        action: &str,
        entity_type: &str,
        entity_id: &str,
        detail: &str,
    ) -> Result<()> {
        self.conn.execute(
            r#"
            insert into activity (id, company_id, actor, action, entity_type, entity_id, detail, created_at)
            values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
            params![
                Uuid::new_v4().to_string(),
                company_id,
                actor,
                action,
                entity_type,
                entity_id,
                detail,
                now_iso()?
            ],
        )?;
        Ok(())
    }

    fn setting(&self, key: &str) -> Result<Option<String>> {
        self.conn
            .query_row(
                "select value from settings where key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()
            .context("failed to read settings row")
    }

    fn query_companies(&self) -> Result<Vec<Company>> {
        query_many(
            &self.conn,
            "select id, name, description, status, auto_approve_hires, review_deliverables, execution_mode, created_at, updated_at from companies order by created_at asc",
            [],
            |row| {
                Ok(Company {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    status: row.get(3)?,
                    auto_approve_hires: int_to_bool(row.get(4)?),
                    review_deliverables: int_to_bool(row.get(5)?),
                    execution_mode: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            },
        )
    }

    fn query_connectors(&self) -> Result<Vec<Connector>> {
        query_many(
            &self.conn,
            "select id, label, description, status, version, auth_state, last_checked_at, last_error, model, env_binding_text, notes from connectors order by label asc",
            [],
            |row| {
                Ok(Connector {
                    id: row.get(0)?,
                    label: row.get(1)?,
                    description: row.get(2)?,
                    status: row.get(3)?,
                    version: row.get(4)?,
                    auth_state: row.get(5)?,
                    last_checked_at: row.get(6)?,
                    last_error: row.get(7)?,
                    model: row.get(8)?,
                    env_binding_text: row.get(9)?,
                    notes: row.get(10)?,
                })
            },
        )
    }

    fn query_workspaces(&self, company_id: Option<&str>) -> Result<Vec<Workspace>> {
        match company_id {
            Some(company_id) => query_many(
                &self.conn,
                "select id, company_id, name, local_path, repo_url, repo_ref, project_id, state, is_primary, created_at, updated_at from workspaces where company_id = ?1 order by is_primary desc, created_at asc",
                [company_id],
                |row| {
                    Ok(Workspace {
                        id: row.get(0)?,
                        company_id: row.get(1)?,
                        name: row.get(2)?,
                        local_path: row.get(3)?,
                        repo_url: row.get(4)?,
                        repo_ref: row.get(5)?,
                        project_id: row.get(6)?,
                        state: row.get(7)?,
                        is_primary: int_to_bool(row.get(8)?),
                        created_at: row.get(9)?,
                        updated_at: row.get(10)?,
                    })
                },
            ),
            None => Ok(Vec::new()),
        }
    }

    fn query_agents(&self, company_id: Option<&str>) -> Result<Vec<Agent>> {
        match company_id {
            Some(company_id) => query_many(
                &self.conn,
                "select id, company_id, name, role, title, department, status, reports_to, connector_id, workspace_id, model, capabilities, budget_monthly_usd, spent_monthly_usd, created_at, updated_at from agents where company_id = ?1 order by created_at asc",
                [company_id],
                |row| {
                    Ok(Agent {
                        id: row.get(0)?,
                        company_id: row.get(1)?,
                        name: row.get(2)?,
                        role: row.get(3)?,
                        title: row.get(4)?,
                        department: row.get(5)?,
                        status: row.get(6)?,
                        reports_to: row.get(7)?,
                        connector_id: row.get(8)?,
                        workspace_id: row.get(9)?,
                        model: row.get(10)?,
                        capabilities: row.get(11)?,
                        budget_monthly_usd: row.get(12)?,
                        spent_monthly_usd: row.get(13)?,
                        created_at: row.get(14)?,
                        updated_at: row.get(15)?,
                    })
                },
            ),
            None => Ok(Vec::new()),
        }
    }

    fn query_goals(&self, company_id: Option<&str>) -> Result<Vec<Goal>> {
        match company_id {
            Some(company_id) => query_many(
                &self.conn,
                "select id, company_id, title, description, parent_id, owner_agent_id, status, created_at, updated_at from goals where company_id = ?1 order by created_at desc",
                [company_id],
                |row| {
                    Ok(Goal {
                        id: row.get(0)?,
                        company_id: row.get(1)?,
                        title: row.get(2)?,
                        description: row.get(3)?,
                        parent_id: row.get(4)?,
                        owner_agent_id: row.get(5)?,
                        status: row.get(6)?,
                        created_at: row.get(7)?,
                        updated_at: row.get(8)?,
                    })
                },
            ),
            None => Ok(Vec::new()),
        }
    }

    fn query_projects(&self, company_id: Option<&str>) -> Result<Vec<Project>> {
        match company_id {
            Some(company_id) => query_many(
                &self.conn,
                "select id, company_id, goal_id, name, description, lead_agent_id, status, target_date, created_at, updated_at from projects where company_id = ?1 order by created_at desc",
                [company_id],
                |row| {
                    Ok(Project {
                        id: row.get(0)?,
                        company_id: row.get(1)?,
                        goal_id: row.get(2)?,
                        name: row.get(3)?,
                        description: row.get(4)?,
                        lead_agent_id: row.get(5)?,
                        status: row.get(6)?,
                        target_date: row.get(7)?,
                        created_at: row.get(8)?,
                        updated_at: row.get(9)?,
                    })
                },
            ),
            None => Ok(Vec::new()),
        }
    }

    fn query_tasks(&self, company_id: Option<&str>) -> Result<Vec<Task>> {
        match company_id {
            Some(company_id) => query_many(
                &self.conn,
                "select id, company_id, project_id, goal_id, parent_id, title, description, assignee_agent_id, workspace_id, status, priority, active_run_id, cost_usd, task_type, requires_user_review, started_at, completed_at, cancelled_at, created_at, updated_at from tasks where company_id = ?1 order by created_at desc",
                [company_id],
                |row| {
                    Ok(Task {
                        id: row.get(0)?,
                        company_id: row.get(1)?,
                        project_id: row.get(2)?,
                        goal_id: row.get(3)?,
                        parent_id: row.get(4)?,
                        title: row.get(5)?,
                        description: row.get(6)?,
                        assignee_agent_id: row.get(7)?,
                        workspace_id: row.get(8)?,
                        status: row.get(9)?,
                        priority: row.get(10)?,
                        active_run_id: row.get(11)?,
                        cost_usd: row.get(12)?,
                        task_type: row.get(13)?,
                        requires_user_review: int_to_bool(row.get(14)?),
                        started_at: row.get(15)?,
                        completed_at: row.get(16)?,
                        cancelled_at: row.get(17)?,
                        created_at: row.get(18)?,
                        updated_at: row.get(19)?,
                    })
                },
            ),
            None => Ok(Vec::new()),
        }
    }

    fn query_approvals(&self, company_id: Option<&str>) -> Result<Vec<Approval>> {
        match company_id {
            Some(company_id) => query_many(
                &self.conn,
                "select id, company_id, related_task_id, related_agent_id, requested_by_agent_id, type, payload_summary, impact_summary, payload_json, decision_note, state, created_at, updated_at from approvals where company_id = ?1 order by created_at desc",
                [company_id],
                |row| {
                    Ok(Approval {
                        id: row.get(0)?,
                        company_id: row.get(1)?,
                        related_task_id: row.get(2)?,
                        related_agent_id: row.get(3)?,
                        requested_by_agent_id: row.get(4)?,
                        approval_type: row.get(5)?,
                        payload_summary: row.get(6)?,
                        impact_summary: row.get(7)?,
                        payload_json: row.get(8)?,
                        decision_note: row.get(9)?,
                        state: row.get(10)?,
                        created_at: row.get(11)?,
                        updated_at: row.get(12)?,
                    })
                },
            ),
            None => Ok(Vec::new()),
        }
    }

    fn query_runs(&self, company_id: Option<&str>) -> Result<Vec<Run>> {
        match company_id {
            Some(company_id) => query_many(
                &self.conn,
                "select id, company_id, task_id, agent_id, workspace_id, connector_id, status, summary, error_message, model, cost_usd, started_at, finished_at, created_at, updated_at from runs where company_id = ?1 order by created_at desc limit 50",
                [company_id],
                |row| {
                    Ok(Run {
                        id: row.get(0)?,
                        company_id: row.get(1)?,
                        task_id: row.get(2)?,
                        agent_id: row.get(3)?,
                        workspace_id: row.get(4)?,
                        connector_id: row.get(5)?,
                        status: row.get(6)?,
                        summary: row.get(7)?,
                        error_message: row.get(8)?,
                        model: row.get(9)?,
                        cost_usd: row.get(10)?,
                        started_at: row.get(11)?,
                        finished_at: row.get(12)?,
                        created_at: row.get(13)?,
                        updated_at: row.get(14)?,
                    })
                },
            ),
            None => Ok(Vec::new()),
        }
    }

    fn query_activity(&self, company_id: Option<&str>) -> Result<Vec<Activity>> {
        match company_id {
            Some(company_id) => query_many(
                &self.conn,
                "select id, company_id, actor, action, entity_type, entity_id, detail, created_at from activity where company_id = ?1 order by created_at desc limit 50",
                [company_id],
                |row| {
                    Ok(Activity {
                        id: row.get(0)?,
                        company_id: row.get(1)?,
                        actor: row.get(2)?,
                        action: row.get(3)?,
                        entity_type: row.get(4)?,
                        entity_id: row.get(5)?,
                        detail: row.get(6)?,
                        created_at: row.get(7)?,
                    })
                },
            ),
            None => Ok(Vec::new()),
        }
    }

    fn query_messages(&self, company_id: Option<&str>) -> Result<Vec<AgentMessage>> {
        match company_id {
            Some(company_id) => query_many(
                &self.conn,
                r#"
                select
                    m.id,
                    m.company_id,
                    m.from_agent_id,
                    m.to_agent_id,
                    m.sender_kind,
                    m.channel,
                    m.channel_target_id,
                    m.subject,
                    m.body,
                    m.priority,
                    coalesce(r.read_at, m.read_at) as effective_read_at,
                    m.parent_message_id,
                    m.attachments_json,
                    m.created_at
                from agent_messages m
                left join agent_message_reads r
                  on r.message_id = m.id and r.agent_id = ?1
                where m.company_id = ?2
                order by m.created_at desc
                limit 200
                "#,
                [BOARD_READER_ID, company_id],
                |row| {
                    Ok(AgentMessage {
                        id: row.get(0)?,
                        company_id: row.get(1)?,
                        from_agent_id: row.get(2)?,
                        to_agent_id: row.get(3)?,
                        sender_kind: row.get(4)?,
                        channel: row.get(5)?,
                        channel_target_id: row.get(6)?,
                        subject: row.get(7)?,
                        body: row.get(8)?,
                        priority: row.get(9)?,
                        read_at: row.get(10)?,
                        parent_message_id: row.get(11)?,
                        attachments_json: row.get(12)?,
                        created_at: row.get(13)?,
                    })
                },
            ),
            None => Ok(Vec::new()),
        }
    }

    fn query_documents(&self, company_id: Option<&str>) -> Result<Vec<Document>> {
        match company_id {
            Some(company_id) => query_many(
                &self.conn,
                "select id, company_id, type, title, content, author_agent_id, reviewer_agent_id, project_id, goal_id, parent_doc_id, version, status, tags_json, latest_revision_id, created_at, updated_at from documents where company_id = ?1 order by updated_at desc",
                [company_id],
                |row| {
                    Ok(Document {
                        id: row.get(0)?,
                        company_id: row.get(1)?,
                        document_type: row.get(2)?,
                        title: row.get(3)?,
                        content: row.get(4)?,
                        author_agent_id: row.get(5)?,
                        reviewer_agent_id: row.get(6)?,
                        project_id: row.get(7)?,
                        goal_id: row.get(8)?,
                        parent_doc_id: row.get(9)?,
                        version: row.get(10)?,
                        status: row.get(11)?,
                        tags_json: row.get(12)?,
                        latest_revision_id: row.get(13)?,
                        created_at: row.get(14)?,
                        updated_at: row.get(15)?,
                    })
                },
            ),
            None => Ok(Vec::new()),
        }
    }
}

fn query_many<T, P, F>(conn: &Connection, sql: &str, params: P, mut mapper: F) -> Result<Vec<T>>
where
    P: rusqlite::Params,
    F: FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
{
    let mut statement = conn.prepare(sql)?;
    let rows = statement.query_map(params, |row| mapper(row))?;
    let mut values = Vec::new();
    for row in rows {
        values.push(row?);
    }
    Ok(values)
}

fn int_to_bool(value: i64) -> bool {
    value != 0
}

fn subject_for(body: &str) -> String {
    let line = body.lines().next().unwrap_or(body).trim();
    let mut subject = line.chars().take(72).collect::<String>();
    if subject.is_empty() {
        subject = "Board update".to_string();
    }
    subject
}

fn normalized_execution_mode(value: &str) -> &str {
    match value {
        "ai_cofounder" => "ai_cofounder",
        _ => "ai_ceo",
    }
}

fn default_locale() -> String {
    match env::var("LANG") {
        Ok(lang) if lang.to_ascii_lowercase().contains("zh") => "zh".to_string(),
        _ => "en".to_string(),
    }
}
