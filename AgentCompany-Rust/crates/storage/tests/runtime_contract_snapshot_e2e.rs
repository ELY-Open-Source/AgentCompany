use storage::{NewCompanyInput, ProfileStore};
use tempfile::tempdir;

#[test]
fn runtime_contract_entities_round_trip_through_snapshot() {
    let sandbox = tempdir().expect("temp dir");
    let mut store = ProfileStore::open(sandbox.path()).expect("open store");

    let company_id = store
        .create_company(NewCompanyInput {
            name: "Orbit Runtime".to_string(),
            description: "Runtime contract verification".to_string(),
            workspace_path: "/tmp/orbit-runtime".to_string(),
            execution_mode: "ai_ceo".to_string(),
        })
        .expect("create company");

    let ts = support::time::now_iso().expect("timestamp");
    let run_id = uuid::Uuid::new_v4().to_string();
    let conn = rusqlite::Connection::open(store.db_path()).expect("open raw db");
    conn.execute(
        "insert into runs (id, company_id, task_id, agent_id, workspace_id, connector_id, status, summary, error_message, model, cost_usd, started_at, finished_at, created_at, updated_at) values (?1, ?2, null, '__board__', null, 'anthropic', 'running', 'Runtime active', null, 'claude-sonnet', 0.25, ?3, null, ?3, ?3)",
        rusqlite::params![run_id, company_id, ts],
    )
    .expect("insert run");

    let event_id = store
        .append_run_event(
            &company_id,
            &run_id,
            "tool_call",
            "write_file",
            "Requested README update",
        )
        .expect("append run event");
    let artifact_id = store
        .register_artifact(
            &company_id,
            &run_id,
            "filesystem",
            "/tmp/orbit-runtime/README.md",
            "README update",
            "{\"path\":\"/tmp/orbit-runtime/README.md\"}",
        )
        .expect("register artifact");

    let snapshot = store.snapshot().expect("snapshot");
    assert!(snapshot.run_events.iter().any(|event| {
        event.id == event_id
            && event.run_id == run_id
            && event.event_kind == "tool_call"
            && event.title == "write_file"
    }));
    assert!(snapshot.artifacts.iter().any(|artifact| {
        artifact.id == artifact_id
            && artifact.run_id == run_id
            && artifact.provider == "filesystem"
            && artifact.title == "README update"
    }));

    let reopened = ProfileStore::open(sandbox.path()).expect("reopen store");
    let reopened_snapshot = reopened.snapshot().expect("reopened snapshot");
    assert!(
        reopened_snapshot
            .run_events
            .iter()
            .any(|event| event.id == event_id)
    );
    assert!(
        reopened_snapshot
            .artifacts
            .iter()
            .any(|artifact| artifact.id == artifact_id)
    );
}
