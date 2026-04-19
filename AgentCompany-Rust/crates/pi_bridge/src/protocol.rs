use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RuntimeHandshake {
    pub protocol_version: u32,
    pub app_name: String,
    pub app_version: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct RunBudget {
    pub thinking_level: Option<String>,
    pub token_budget: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RunRequest {
    pub run_id: String,
    pub session_id: Option<String>,
    pub company_id: String,
    pub task_id: Option<String>,
    pub agent_id: String,
    pub workspace_path: Option<String>,
    pub connector_id: String,
    pub model: Option<String>,
    pub prompt: String,
    pub context_json: serde_json::Value,
    pub budget: RunBudget,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ToolApprovalDecision {
    pub run_id: String,
    pub tool_call_id: String,
    pub approved: bool,
    pub note: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SteerRequest {
    pub run_id: String,
    pub body: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FollowUpRequest {
    pub run_id: String,
    pub body: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ClientRequest {
    Handshake(RuntimeHandshake),
    StartRun(Box<RunRequest>),
    ToolApproval(ToolApprovalDecision),
    Steer(SteerRequest),
    FollowUp(FollowUpRequest),
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RuntimeEvent {
    HandshakeAck {
        protocol_version: u32,
        runtime_version: String,
    },
    Message {
        run_id: String,
        role: String,
        body: String,
    },
    ToolCall {
        run_id: String,
        tool_call_id: String,
        tool_name: String,
        input_json: serde_json::Value,
    },
    ToolResult {
        run_id: String,
        tool_call_id: String,
        output_json: serde_json::Value,
    },
    Artifact {
        run_id: String,
        provider: String,
        external_id: String,
        title: String,
        metadata_json: serde_json::Value,
    },
    RunFinished {
        run_id: String,
        status: String,
        summary: String,
        session_id: Option<String>,
        cost_usd: Option<f64>,
    },
}
