use domain::ApprovalState;
use storage::{NewCompanyInput, ProfileStore};
use tempfile::tempdir;

#[test]
fn profile_store_bootstraps_and_round_trips_core_flows() {
    let sandbox = tempdir().expect("temp dir");
    let mut store = ProfileStore::open(sandbox.path()).expect("open store");

    let company_id = store
        .create_company(NewCompanyInput {
            name: "Orbit Lab".to_string(),
            description: "Semantic communication thesis program".to_string(),
            workspace_path: "/tmp/orbit-lab".to_string(),
            execution_mode: "ai_ceo".to_string(),
        })
        .expect("create company");

    let snapshot = store.snapshot().expect("snapshot");
    assert_eq!(snapshot.companies.len(), 1);
    assert_eq!(snapshot.workspaces.len(), 1);
    assert_eq!(
        snapshot.current_company_id.as_deref(),
        Some(company_id.as_str())
    );
    assert_eq!(snapshot.connectors.len(), 26);

    let approval_id = uuid::Uuid::new_v4().to_string();
    let ts = support::time::now_iso().expect("timestamp");
    let conn = rusqlite::Connection::open(store.db_path()).expect("open raw db");
    conn.execute(
        "insert into approvals (id, company_id, related_task_id, requested_by_agent_id, related_agent_id, type, payload_summary, impact_summary, payload_json, decision_note, state, created_at, updated_at) values (?1, ?2, null, null, null, 'strategy_review', 'Review launch plan', 'Affects milestone timing', null, '', 'pending', ?3, ?3)",
        rusqlite::params![approval_id, company_id, ts],
    )
    .expect("insert approval");

    store
        .decide_approval(
            &company_id,
            &approval_id,
            ApprovalState::Approved,
            "Ship the native shell.",
        )
        .expect("decide approval");
    store
        .send_board_message(&company_id, "Board update: thesis plan is in review.")
        .expect("send message");
    store
        .create_document(
            &company_id,
            "Weekly status",
            "Native Rust shell connected to the real profile.",
        )
        .expect("create document");

    let after = store.snapshot().expect("snapshot after writes");
    assert_eq!(after.pending_approvals(), 0);
    assert_eq!(after.agent_messages.len(), 1);
    assert_eq!(after.documents.len(), 1);
    assert!(!after.activity.is_empty());
}
