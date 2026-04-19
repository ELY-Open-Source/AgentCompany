use storage::{NewCompanyInput, ProfileStore};
use tempfile::tempdir;

#[test]
fn inbox_attention_derivation_round_trips_through_snapshot() {
    let sandbox = tempdir().expect("temp dir");
    let mut store = ProfileStore::open(sandbox.path()).expect("open store");

    let company_id = store
        .create_company(NewCompanyInput {
            name: "Orbit Inbox".to_string(),
            description: "Verifies native inbox derivation".to_string(),
            workspace_path: "/tmp/orbit-inbox".to_string(),
            execution_mode: "ai_ceo".to_string(),
        })
        .expect("create company");

    let ts = support::time::now_iso().expect("timestamp");
    let approval_id = uuid::Uuid::new_v4().to_string();
    let run_id = uuid::Uuid::new_v4().to_string();

    let conn = rusqlite::Connection::open(store.db_path()).expect("open raw db");
    conn.execute(
        "insert into approvals (id, company_id, related_task_id, requested_by_agent_id, related_agent_id, type, payload_summary, impact_summary, payload_json, decision_note, state, created_at, updated_at) values (?1, ?2, null, null, null, 'runtime_tool_call', 'Review shell command', 'Blocks workspace write', null, '', 'pending', ?3, ?3)",
        rusqlite::params![approval_id, company_id, ts],
    )
    .expect("insert approval");
    conn.execute(
        "insert into runs (id, company_id, task_id, agent_id, workspace_id, connector_id, status, summary, error_message, model, cost_usd, started_at, finished_at, created_at, updated_at) values (?1, ?2, null, '__board__', null, 'anthropic', 'failed', 'Workspace write failed', 'permission denied', 'claude-sonnet', 0.5, ?3, ?3, ?3, ?3)",
        rusqlite::params![run_id, company_id, ts],
    )
    .expect("insert failed run");
    let message_id = store
        .send_board_message(
            &company_id,
            "Board update: human review is required before retry.",
        )
        .expect("send board message");

    let snapshot = store.snapshot().expect("snapshot");
    assert_eq!(snapshot.pending_approvals(), 1);
    assert_eq!(snapshot.unread_messages(), 1);
    assert_eq!(snapshot.active_runs(), 0);
    assert!(
        snapshot
            .runs
            .iter()
            .any(|run| run.id == run_id && run.status == "failed")
    );
    assert!(
        snapshot
            .agent_messages
            .iter()
            .any(|message| message.id == message_id && message.read_at.is_none())
    );

    store
        .mark_message_read(&company_id, &message_id)
        .expect("mark message read");
    let reopened = ProfileStore::open(sandbox.path()).expect("reopen store");
    let reopened_snapshot = reopened.snapshot().expect("reopened snapshot");
    assert_eq!(reopened_snapshot.pending_approvals(), 1);
    assert_eq!(reopened_snapshot.unread_messages(), 0);
    assert!(
        reopened_snapshot.runs.iter().any(
            |run| run.id == run_id && run.error_message.as_deref() == Some("permission denied")
        )
    );
}
