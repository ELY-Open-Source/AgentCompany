use storage::{NewCompanyInput, ProfileStore};
use tempfile::tempdir;

#[test]
fn native_surface_snapshot_round_trips_reviews_runs_and_documents() {
    let sandbox = tempdir().expect("temp dir");
    let mut store = ProfileStore::open(sandbox.path()).expect("open store");

    let company_id = store
        .create_company(NewCompanyInput {
            name: "Orbit Ops".to_string(),
            description: "Local service operator".to_string(),
            workspace_path: "/tmp/orbit-ops".to_string(),
            execution_mode: "ai_ceo".to_string(),
        })
        .expect("create company");

    let ts = support::time::now_iso().expect("timestamp");
    let task_id = uuid::Uuid::new_v4().to_string();
    let approval_id = uuid::Uuid::new_v4().to_string();
    let run_id = uuid::Uuid::new_v4().to_string();

    let conn = rusqlite::Connection::open(store.db_path()).expect("open raw db");
    conn.execute(
        "insert into tasks (id, company_id, project_id, goal_id, parent_id, title, description, assignee_agent_id, workspace_id, status, priority, active_run_id, cost_usd, task_type, requires_user_review, started_at, completed_at, cancelled_at, created_at, updated_at) values (?1, ?2, null, null, null, 'Operationalize launch plan', 'Awaiting review from board', null, null, 'in_review', 'high', ?3, 0, 'review', 1, ?4, null, null, ?4, ?4)",
        rusqlite::params![task_id, company_id, run_id, ts],
    )
    .expect("insert review task");
    conn.execute(
        "insert into approvals (id, company_id, related_task_id, requested_by_agent_id, related_agent_id, type, payload_summary, impact_summary, payload_json, decision_note, state, created_at, updated_at) values (?1, ?2, ?3, null, null, 'plan_review', 'Review launch plan', 'Board decision blocks execution', null, '', 'pending', ?4, ?4)",
        rusqlite::params![approval_id, company_id, task_id, ts],
    )
    .expect("insert pending approval");
    conn.execute(
        "insert into runs (id, company_id, task_id, agent_id, workspace_id, connector_id, status, summary, error_message, model, cost_usd, started_at, finished_at, created_at, updated_at) values (?1, ?2, ?3, '__board__', null, 'anthropic', 'running', 'Executing launch checklist', null, 'claude-sonnet', 1.5, ?4, null, ?4, ?4)",
        rusqlite::params![run_id, company_id, task_id, ts],
    )
    .expect("insert running run");

    let document_id = store
        .create_document(
            &company_id,
            "Launch brief",
            "Board-ready operating brief for the native shell.",
        )
        .expect("create document");

    let snapshot = store.snapshot().expect("snapshot");
    assert_eq!(
        snapshot.current_company_id.as_deref(),
        Some(company_id.as_str())
    );
    assert_eq!(snapshot.pending_approvals(), 1);
    assert_eq!(snapshot.active_runs(), 1);
    assert_eq!(snapshot.documents.len(), 1);
    assert_eq!(snapshot.documents[0].id, document_id);
    assert!(snapshot.tasks.iter().any(|task| task.id == task_id));
    assert!(
        snapshot
            .approvals
            .iter()
            .any(|approval| approval.id == approval_id)
    );
    assert!(snapshot.runs.iter().any(|run| run.id == run_id));

    let reopened = ProfileStore::open(sandbox.path()).expect("reopen store");
    let reopened_snapshot = reopened.snapshot().expect("reopened snapshot");
    assert_eq!(reopened_snapshot.pending_approvals(), 1);
    assert_eq!(reopened_snapshot.active_runs(), 1);
    assert!(
        reopened_snapshot
            .tasks
            .iter()
            .any(|task| task.id == task_id)
    );
    assert!(
        reopened_snapshot
            .documents
            .iter()
            .any(|document| document.id == document_id)
    );
}
