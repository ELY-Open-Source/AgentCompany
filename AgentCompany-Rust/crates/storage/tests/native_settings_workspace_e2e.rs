use storage::{NewCompanyInput, ProfileStore};
use tempfile::tempdir;

#[test]
fn settings_and_workspace_mutations_round_trip_through_snapshot() {
    let sandbox = tempdir().expect("temp dir");
    let mut store = ProfileStore::open(sandbox.path()).expect("open store");

    let company_id = store
        .create_company(NewCompanyInput {
            name: "Orbit Settings".to_string(),
            description: "Native control plane".to_string(),
            workspace_path: "/tmp/orbit-settings".to_string(),
            execution_mode: "ai_ceo".to_string(),
        })
        .expect("create company");

    let ts = support::time::now_iso().expect("timestamp");
    let secondary_workspace_id = uuid::Uuid::new_v4().to_string();
    let conn = rusqlite::Connection::open(store.db_path()).expect("open raw db");
    conn.execute(
        "insert into workspaces (id, company_id, name, local_path, repo_url, repo_ref, project_id, state, is_primary, created_at, updated_at) values (?1, ?2, 'Secondary Workspace', '/tmp/orbit-settings/secondary', '', '', null, 'blocked', 0, ?3, ?3)",
        rusqlite::params![secondary_workspace_id, company_id, ts],
    )
    .expect("insert secondary workspace");

    store.update_theme("dark").expect("update theme");
    store.update_locale("zh").expect("update locale");
    store
        .update_execution_mode(&company_id, "ai_cofounder")
        .expect("update execution mode");
    store
        .set_primary_workspace(&company_id, &secondary_workspace_id)
        .expect("set primary workspace");

    let snapshot = store.snapshot().expect("snapshot");
    assert_eq!(snapshot.theme, "dark");
    assert_eq!(snapshot.locale, "zh");
    let company = snapshot
        .companies
        .iter()
        .find(|item| item.id == company_id)
        .expect("company present");
    assert_eq!(company.execution_mode, "ai_cofounder");
    let primary_workspace = snapshot
        .workspaces
        .iter()
        .find(|workspace| workspace.is_primary)
        .expect("primary workspace present");
    assert_eq!(primary_workspace.id, secondary_workspace_id);

    let reopened = ProfileStore::open(sandbox.path()).expect("reopen store");
    let reopened_snapshot = reopened.snapshot().expect("reopened snapshot");
    assert_eq!(reopened_snapshot.theme, "dark");
    assert_eq!(reopened_snapshot.locale, "zh");
    assert!(
        reopened_snapshot
            .workspaces
            .iter()
            .any(|workspace| workspace.id == secondary_workspace_id && workspace.is_primary)
    );
}
