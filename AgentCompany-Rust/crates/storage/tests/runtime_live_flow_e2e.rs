use pi_bridge::RuntimeEvent;
use storage::{NewCompanyInput, ProfileStore};
use tempfile::tempdir;

#[test]
fn live_runtime_events_drive_approvals_messages_and_run_state() {
    let sandbox = tempdir().expect("temp dir");
    let mut store = ProfileStore::open(sandbox.path()).expect("open store");

    let company_id = store
        .create_company(NewCompanyInput {
            name: "Orbit Live Runtime".to_string(),
            description: "Verifies live runtime wiring".to_string(),
            workspace_path: "/tmp/orbit-live-runtime".to_string(),
            execution_mode: "ai_ceo".to_string(),
        })
        .expect("create company");

    let ts = support::time::now_iso().expect("timestamp");
    let task_id = uuid::Uuid::new_v4().to_string();
    let run_id = uuid::Uuid::new_v4().to_string();
    let agent_id = uuid::Uuid::new_v4().to_string();
    let workspace_id = uuid::Uuid::new_v4().to_string();

    let conn = rusqlite::Connection::open(store.db_path()).expect("open raw db");
    conn.execute(
        "insert into workspaces (id, company_id, name, local_path, repo_url, repo_ref, project_id, state, is_primary, created_at, updated_at) values (?1, ?2, 'Primary Workspace', '/tmp/orbit-live-runtime', '', '', null, 'ready', 1, ?3, ?3)",
        rusqlite::params![workspace_id, company_id, ts],
    )
    .expect("insert workspace");
    conn.execute(
        "insert into agents (id, company_id, name, role, title, department, status, reports_to, connector_id, workspace_id, model, capabilities, budget_monthly_usd, spent_monthly_usd, created_at, updated_at) values (?1, ?2, 'Alex Runtime', 'engineer', 'Runtime Engineer', null, 'idle', null, 'anthropic', ?3, 'claude-sonnet', '[]', 0, 0, ?4, ?4)",
        rusqlite::params![agent_id, company_id, workspace_id, ts],
    )
    .expect("insert agent");
    conn.execute(
        "insert into tasks (id, company_id, project_id, goal_id, parent_id, title, description, assignee_agent_id, workspace_id, status, priority, active_run_id, cost_usd, task_type, requires_user_review, started_at, completed_at, cancelled_at, created_at, updated_at) values (?1, ?2, null, null, null, 'Ship runtime rewrite', 'Keep the native app in sync with Pi Mono.', ?3, ?4, 'todo', 'high', null, 0, 'execution', 1, null, null, null, ?5, ?5)",
        rusqlite::params![task_id, company_id, agent_id, workspace_id, ts],
    )
    .expect("insert task");
    conn.execute(
        "insert into runs (id, company_id, task_id, agent_id, workspace_id, connector_id, status, summary, error_message, model, cost_usd, started_at, finished_at, created_at, updated_at) values (?1, ?2, ?3, ?4, ?5, 'anthropic', 'queued', 'Queued from native UI', null, 'claude-sonnet', null, null, null, ?6, ?6)",
        rusqlite::params![run_id, company_id, task_id, agent_id, workspace_id, ts],
    )
    .expect("insert run");

    store.mark_run_started(&run_id).expect("mark run started");
    store
        .ingest_runtime_event(RuntimeEvent::ToolCall {
            run_id: run_id.clone(),
            tool_call_id: "tool-1".to_string(),
            tool_name: "write_file".to_string(),
            input_json: serde_json::json!({"path": "README.md"}),
        })
        .expect("ingest tool call");
    store
        .ingest_runtime_event(RuntimeEvent::Message {
            run_id: run_id.clone(),
            role: "assistant".to_string(),
            body: "Draft ready for review".to_string(),
        })
        .expect("ingest message");
    store
        .ingest_runtime_event(RuntimeEvent::RunFinished {
            run_id: run_id.clone(),
            status: "completed".to_string(),
            summary: "Native runtime finished cleanly".to_string(),
            session_id: Some(run_id.clone()),
            cost_usd: Some(2.5),
        })
        .expect("ingest finished event");

    let snapshot = store.snapshot().expect("snapshot");
    let task = snapshot
        .tasks
        .iter()
        .find(|task| task.id == task_id)
        .expect("task present");
    assert_eq!(task.active_run_id, None);

    let approval = snapshot
        .approvals
        .iter()
        .find(|approval| approval.approval_type == "runtime_tool_call")
        .expect("runtime approval present");
    assert_eq!(approval.related_task_id.as_deref(), Some(task_id.as_str()));
    assert_eq!(
        approval.related_agent_id.as_deref(),
        Some(agent_id.as_str())
    );
    assert_eq!(approval.payload_summary, "write_file");
    assert!(
        approval
            .payload_json
            .as_deref()
            .expect("payload json")
            .contains("tool-1")
    );

    let runtime_message = snapshot
        .agent_messages
        .iter()
        .find(|message| {
            message.channel == "run"
                && message.channel_target_id.as_deref() == Some(run_id.as_str())
        })
        .expect("runtime message projected");
    assert_eq!(runtime_message.from_agent_id, agent_id);
    assert_eq!(runtime_message.body, "Draft ready for review");

    let run = snapshot
        .runs
        .iter()
        .find(|run| run.id == run_id)
        .expect("run present");
    assert_eq!(run.status, "completed");
    assert_eq!(run.summary, "Native runtime finished cleanly");
    assert_eq!(run.cost_usd, Some(2.5));
    assert!(run.started_at.is_some());
    assert!(run.finished_at.is_some());
}
