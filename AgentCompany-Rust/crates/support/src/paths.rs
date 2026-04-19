use anyhow::{Result, anyhow};
use std::{
    env, fs,
    path::{Path, PathBuf},
};

pub const APP_NAME: &str = "AgentCompany";
pub const PROFILE_ENV: &str = "AGENTCOMPANY_PROFILE_DIR";

pub fn default_profile_dir() -> Result<PathBuf> {
    dirs::data_dir()
        .map(|path| path.join(APP_NAME).join("profile"))
        .ok_or_else(|| anyhow!("OS data directory is unavailable"))
}

pub fn resolve_profile_dir() -> Result<PathBuf> {
    match env::var(PROFILE_ENV) {
        Ok(value) if !value.trim().is_empty() => Ok(PathBuf::from(value)),
        _ => default_profile_dir(),
    }
}

pub fn profile_db_path(profile_dir: &Path) -> PathBuf {
    profile_dir.join("profile.sqlite")
}

pub fn ensure_profile_dir(profile_dir: &Path) -> Result<()> {
    fs::create_dir_all(profile_dir)?;
    Ok(())
}
