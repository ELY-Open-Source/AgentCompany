use pi_bridge::RuntimeEvent;
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

    store
        .ingest_runtime_event(RuntimeEvent::Message {
            run_id: run_id.clone(),
            role: "assistant".to_string(),
            body: "Draft ready".to_string(),
        })
        .expect("ingest message event");
    store
        .ingest_runtime_event(RuntimeEvent::Artifact {
            run_id: run_id.clone(),
            provider: "filesystem".to_string(),
            external_id: "/tmp/orbit-runtime/output.txt".to_string(),
            title: "output.txt".to_string(),
            metadata_json: serde_json::json!({"path": "/tmp/orbit-runtime/output.txt"}),
        })
        .expect("ingest artifact event");
    store
        .ingest_runtime_event(RuntimeEvent::RunFinished {
            run_id: run_id.clone(),
            status: "completed".to_string(),
            summary: "Run complete".to_string(),
            session_id: Some("session-1".to_string()),
            cost_usd: Some(1.25),
        })
        .expect("ingest run finished event");

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
    assert!(snapshot.run_events.iter().any(|event| {
        event.run_id == run_id && event.event_kind == "message" && event.detail == "Draft ready"
    }));
    assert!(
        snapshot
            .artifacts
            .iter()
            .any(|artifact| { artifact.run_id == run_id && artifact.title == "output.txt" })
    );
    let run = snapshot
        .runs
        .iter()
        .find(|run| run.id == run_id)
        .expect("run present");
    assert_eq!(run.status, "completed");
    assert_eq!(run.summary, "Run complete");
    assert_eq!(run.cost_usd, Some(1.25));
    assert!(run.finished_at.is_some());

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
    assert!(
        reopened_snapshot
            .runs
            .iter()
            .any(|run| run.id == run_id && run.status == "completed")
    );
}
