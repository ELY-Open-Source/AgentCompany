use crate::{
    Activity, Agent, AgentMessage, Approval, Company, Connector, Document, Goal, Project, Run,
    Task, Workspace,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ProfileSnapshot {
    pub current_company_id: Option<String>,
    pub profile_path: String,
    pub theme: String,
    pub locale: String,
    pub companies: Vec<Company>,
    pub connectors: Vec<Connector>,
    pub workspaces: Vec<Workspace>,
    pub agents: Vec<Agent>,
    pub goals: Vec<Goal>,
    pub projects: Vec<Project>,
    pub tasks: Vec<Task>,
    pub approvals: Vec<Approval>,
    pub runs: Vec<Run>,
    pub activity: Vec<Activity>,
    pub agent_messages: Vec<AgentMessage>,
    pub documents: Vec<Document>,
}

impl ProfileSnapshot {
    pub fn current_company(&self) -> Option<&Company> {
        self.current_company_id
            .as_ref()
            .and_then(|company_id| {
                self.companies
                    .iter()
                    .find(|company| &company.id == company_id)
            })
            .or_else(|| self.companies.first())
    }

    pub fn unread_messages(&self) -> usize {
        self.agent_messages
            .iter()
            .filter(|message| message.read_at.is_none())
            .count()
    }

    pub fn pending_approvals(&self) -> usize {
        self.approvals
            .iter()
            .filter(|approval| approval.state == "pending")
            .count()
    }

    pub fn active_tasks(&self) -> usize {
        self.tasks
            .iter()
            .filter(|task| matches!(task.status.as_str(), "todo" | "in_progress" | "in_review"))
            .count()
    }

    pub fn active_runs(&self) -> usize {
        self.runs
            .iter()
            .filter(|run| {
                matches!(
                    run.status.as_str(),
                    "queued" | "running" | "waiting_approval" | "paused"
                )
            })
            .count()
    }
}
