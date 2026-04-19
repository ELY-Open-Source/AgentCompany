use storage::{OnboardingBootstrapInput, ProfileStore};
use tempfile::tempdir;

#[test]
fn onboarding_bootstrap_creates_company_goal_agent_project_task_and_run() {
    let sandbox = tempdir().expect("temp dir");
    let mut store = ProfileStore::open(sandbox.path()).expect("open store");

    let summary = store
        .bootstrap_onboarding(OnboardingBootstrapInput {
            company_name: "Orbit Ops".to_string(),
            company_description: "Local-first operations company".to_string(),
            workspace_path: "/tmp/orbit-ops".to_string(),
            execution_mode: "ai_ceo".to_string(),
            goal_title: "Ship the native shell".to_string(),
            goal_description:
                "Rebuild the product in Rust and GPUI without losing product grammar.".to_string(),
            connector_id: "anthropic".to_string(),
            connector_model: Some("claude-sonnet".to_string()),
        })
        .expect("bootstrap onboarding");

    let snapshot = store.snapshot().expect("snapshot");
    assert_eq!(
        snapshot.current_company_id.as_deref(),
        Some(summary.company_id.as_str())
    );
    assert!(
        snapshot
            .companies
            .iter()
            .any(|company| company.id == summary.company_id && company.name == "Orbit Ops")
    );
    assert!(
        snapshot
            .workspaces
            .iter()
            .any(|workspace| Some(workspace.id.as_str()) == summary.workspace_id.as_deref())
    );
    assert!(
        snapshot
            .goals
            .iter()
            .any(|goal| goal.title == "Ship the native shell" && goal.status == "active")
    );
    assert!(snapshot.agents.iter().any(|agent| {
        agent.id == summary.lead_agent_id
            && agent.name == "CEO"
            && agent.connector_id == "anthropic"
            && agent.model.as_deref() == Some("claude-sonnet")
    }));
    assert!(
        snapshot
            .projects
            .iter()
            .any(|project| project.id == summary.project_id && project.status == "in_progress")
    );
    assert!(snapshot.tasks.iter().any(|task| {
        task.id == summary.task_id
            && task.active_run_id.as_deref() == Some(summary.run_id.as_str())
            && task.assignee_agent_id.as_deref() == Some(summary.lead_agent_id.as_str())
    }));
    assert!(snapshot.runs.iter().any(|run| {
        run.id == summary.run_id
            && run.agent_id == summary.lead_agent_id
            && run.status == "queued"
            && run.task_id.as_deref() == Some(summary.task_id.as_str())
    }));
    assert!(snapshot.activity.iter().any(|activity| {
        activity.entity_id == summary.company_id && activity.action == "company.bootstrapped"
    }));

    let reopened = ProfileStore::open(sandbox.path()).expect("reopen store");
    let reopened_snapshot = reopened.snapshot().expect("reopened snapshot");
    assert!(
        reopened_snapshot
            .runs
            .iter()
            .any(|run| run.id == summary.run_id && run.status == "queued")
    );
}
