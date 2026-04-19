use anyhow::{Result, anyhow};
use std::{
    env, fs,
    path::{Path, PathBuf},
};

pub const APP_NAME: &str = "AgentCompanyNative";
pub const PROFILE_DB_FILE_NAME: &str = "agentcompany-native-v1.sqlite3";
pub const PROFILE_ENV: &str = "AGENTCOMPANY_NATIVE_PROFILE_DIR";
pub const RUNTIME_COMMAND_ENV: &str = "AGENTCOMPANY_NATIVE_PI_COMMAND";
pub const RUNTIME_ARGS_ENV: &str = "AGENTCOMPANY_NATIVE_PI_ARGS_JSON";
pub const RUNTIME_WORKDIR_ENV: &str = "AGENTCOMPANY_NATIVE_PI_WORKDIR";

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
    profile_dir.join(PROFILE_DB_FILE_NAME)
}

pub fn ensure_profile_dir(profile_dir: &Path) -> Result<()> {
    fs::create_dir_all(profile_dir)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        APP_NAME, PROFILE_DB_FILE_NAME, PROFILE_ENV, RUNTIME_ARGS_ENV, RUNTIME_COMMAND_ENV,
        RUNTIME_WORKDIR_ENV, default_profile_dir, profile_db_path,
    };

    #[test]
    fn default_profile_dir_uses_native_app_namespace() {
        let profile_dir = default_profile_dir().expect("resolve default profile dir");
        let profile_path = profile_dir.to_string_lossy();

        assert!(profile_path.contains(APP_NAME));
        assert!(!profile_path.contains("AgentCompany/profile"));
        assert!(!profile_path.contains("AgentCompany-Rust/profile"));
    }

    #[test]
    fn profile_db_path_uses_native_database_file_name() {
        let profile_dir = std::path::Path::new("/tmp/agentcompany-native/profile");
        let db_path = profile_db_path(profile_dir);

        assert_eq!(
            db_path.file_name().and_then(|value| value.to_str()),
            Some(PROFILE_DB_FILE_NAME)
        );
        assert_ne!(
            db_path.file_name().and_then(|value| value.to_str()),
            Some("profile.sqlite")
        );
        assert_ne!(
            db_path.file_name().and_then(|value| value.to_str()),
            Some("agentcompany-native.sqlite")
        );
    }

    #[test]
    fn native_environment_variable_names_do_not_overlap_with_legacy_names() {
        assert_eq!(PROFILE_ENV, "AGENTCOMPANY_NATIVE_PROFILE_DIR");
        assert_eq!(RUNTIME_COMMAND_ENV, "AGENTCOMPANY_NATIVE_PI_COMMAND");
        assert_eq!(RUNTIME_ARGS_ENV, "AGENTCOMPANY_NATIVE_PI_ARGS_JSON");
        assert_eq!(RUNTIME_WORKDIR_ENV, "AGENTCOMPANY_NATIVE_PI_WORKDIR");
    }
}
