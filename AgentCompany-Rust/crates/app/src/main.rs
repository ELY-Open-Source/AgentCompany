use anyhow::Result;
use parking_lot::Mutex;
use std::sync::Arc;
use storage::ProfileStore;
use support::paths::resolve_profile_dir;

fn main() -> Result<()> {
    let profile_dir = resolve_profile_dir()?;
    let store = Arc::new(Mutex::new(ProfileStore::open(&profile_dir)?));
    let snapshot = store.lock().snapshot()?;
    app_ui::launch(store, snapshot);
    Ok(())
}
