use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Company {
    pub id: String,
    pub name: String,
    pub description: String,
    pub status: String,
    pub auto_approve_hires: bool,
    pub review_deliverables: bool,
    pub execution_mode: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Connector {
    pub id: String,
    pub label: String,
    pub description: String,
    pub status: String,
    pub version: Option<String>,
    pub auth_state: String,
    pub last_checked_at: Option<String>,
    pub last_error: Option<String>,
    pub model: Option<String>,
    pub env_binding_text: String,
    pub notes: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub company_id: String,
    pub name: String,
    pub local_path: String,
    pub repo_url: String,
    pub repo_ref: String,
    pub project_id: Option<String>,
    pub state: String,
    pub is_primary: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Agent {
    pub id: String,
    pub company_id: String,
    pub name: String,
    pub role: String,
    pub title: String,
    pub department: Option<String>,
    pub status: String,
    pub reports_to: Option<String>,
    pub connector_id: String,
    pub workspace_id: Option<String>,
    pub model: Option<String>,
    pub capabilities: String,
    pub budget_monthly_usd: f64,
    pub spent_monthly_usd: f64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Goal {
    pub id: String,
    pub company_id: String,
    pub title: String,
    pub description: String,
    pub parent_id: Option<String>,
    pub owner_agent_id: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub company_id: String,
    pub goal_id: Option<String>,
    pub name: String,
    pub description: String,
    pub lead_agent_id: Option<String>,
    pub status: String,
    pub target_date: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub company_id: String,
    pub project_id: Option<String>,
    pub goal_id: Option<String>,
    pub parent_id: Option<String>,
    pub title: String,
    pub description: String,
    pub assignee_agent_id: Option<String>,
    pub workspace_id: Option<String>,
    pub status: String,
    pub priority: String,
    pub active_run_id: Option<String>,
    pub cost_usd: f64,
    pub task_type: Option<String>,
    pub requires_user_review: bool,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub cancelled_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Approval {
    pub id: String,
    pub company_id: String,
    pub related_task_id: Option<String>,
    pub related_agent_id: Option<String>,
    pub requested_by_agent_id: Option<String>,
    pub approval_type: String,
    pub payload_summary: String,
    pub impact_summary: String,
    pub payload_json: Option<String>,
    pub decision_note: String,
    pub state: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Run {
    pub id: String,
    pub company_id: String,
    pub task_id: Option<String>,
    pub agent_id: String,
    pub workspace_id: Option<String>,
    pub connector_id: String,
    pub status: String,
    pub summary: String,
    pub error_message: Option<String>,
    pub model: Option<String>,
    pub cost_usd: Option<f64>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Activity {
    pub id: String,
    pub company_id: String,
    pub actor: String,
    pub action: String,
    pub entity_type: String,
    pub entity_id: String,
    pub detail: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct AgentMessage {
    pub id: String,
    pub company_id: String,
    pub from_agent_id: String,
    pub to_agent_id: Option<String>,
    pub sender_kind: String,
    pub channel: String,
    pub channel_target_id: Option<String>,
    pub subject: String,
    pub body: String,
    pub priority: String,
    pub read_at: Option<String>,
    pub parent_message_id: Option<String>,
    pub attachments_json: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Document {
    pub id: String,
    pub company_id: String,
    pub document_type: String,
    pub title: String,
    pub content: String,
    pub author_agent_id: Option<String>,
    pub reviewer_agent_id: Option<String>,
    pub project_id: Option<String>,
    pub goal_id: Option<String>,
    pub parent_doc_id: Option<String>,
    pub version: i64,
    pub status: String,
    pub tags_json: String,
    pub latest_revision_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct RunEventRecord {
    pub id: String,
    pub company_id: String,
    pub run_id: String,
    pub event_kind: String,
    pub title: String,
    pub detail: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ArtifactRecord {
    pub id: String,
    pub company_id: String,
    pub run_id: String,
    pub provider: String,
    pub external_id: String,
    pub title: String,
    pub metadata_json: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ThreadWaitState {
    pub id: String,
    pub thread_id: String,
    pub company_id: String,
    pub waiting_for: String,
    pub related_approval_id: Option<String>,
    pub reason: String,
    pub created_at: String,
    pub resolved_at: Option<String>,
}
