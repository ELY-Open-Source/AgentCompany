use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SectionId {
    #[default]
    Overview,
    Runs,
    Inbox,
    Messages,
    Approvals,
    Documents,
    Workspaces,
    Settings,
}

impl SectionId {
    pub fn label(self) -> &'static str {
        match self {
            Self::Overview => "Dashboard",
            Self::Runs => "Runs",
            Self::Inbox => "Inbox",
            Self::Messages => "Messages",
            Self::Approvals => "Approvals",
            Self::Documents => "Documents",
            Self::Workspaces => "Workspaces",
            Self::Settings => "Settings",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompanyStatus {
    #[default]
    Active,
    Paused,
    Archived,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionMode {
    #[default]
    AiCeo,
    AiCofounder,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceState {
    Ready,
    Busy,
    Blocked,
    Missing,
    Error,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    Idle,
    Active,
    Running,
    Paused,
    Error,
    PendingApproval,
    Terminated,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Backlog,
    Todo,
    InProgress,
    InReview,
    Done,
    Blocked,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalState {
    Pending,
    Approved,
    Rejected,
    RevisionRequested,
}

impl ApprovalState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Approved => "approved",
            Self::Rejected => "rejected",
            Self::RevisionRequested => "revision_requested",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageChannel {
    Direct,
    Company,
    Department,
    Project,
    Incident,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DocumentStatus {
    Draft,
    InReview,
    Approved,
    Archived,
    Superseded,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThreadWaitingFor {
    HumanApproval,
    HumanReply,
    ToolResult,
    ExternalEvent,
}
