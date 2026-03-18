const ENV_ALLOWLIST: ReadonlySet<string> = new Set([
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TMPDIR",
  "DEVELOPER_DIR",
  "SDKROOT",
  "NODE_ENV",
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
  "GIT_SSH_COMMAND",
  "GIT_ASKPASS",
  "GIT_TERMINAL_PROMPT",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_RUNTIME_DIR",
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "DBUS_SESSION_BUS_ADDRESS",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "SYSTEMROOT",
  "COMSPEC",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMDATA",
  "PATHEXT",
  "AGENT_COMPANY_AGENT_ID",
  "AGENT_COMPANY_COMPANY_ID",
  "AGENT_COMPANY_API_URL",
  "AGENT_COMPANY_API_KEY",
  "AGENT_COMPANY_RUN_ID",
  "AGENT_COMPANY_TASK_ID",
  "AGENT_COMPANY_WAKE_REASON",
  "AGENT_COMPANY_WAKE_COMMENT_ID",
  "AGENT_COMPANY_APPROVAL_ID",
  "AGENT_COMPANY_APPROVAL_STATUS",
  "AGENT_COMPANY_WORKSPACE_CWD",
  "AGENT_COMPANY_WORKSPACE_SOURCE",
  "AGENT_COMPANY_WORKSPACE_STRATEGY",
  "AGENT_COMPANY_WORKSPACE_ID",
  "AGENT_COMPANY_WORKSPACE_REPO_URL",
  "AGENT_COMPANY_WORKSPACE_REPO_REF",
  "AGENT_COMPANY_WORKSPACE_BRANCH",
  "AGENT_COMPANY_WORKSPACE_WORKTREE_PATH",
  "AGENT_COMPANY_WORKSPACES_JSON",
  "AGENT_COMPANY_RUNTIME_SERVICE_INTENTS_JSON",
  "AGENT_COMPANY_RUNTIME_SERVICES_JSON",
  "AGENT_COMPANY_RUNTIME_PRIMARY_URL",
  "AGENT_COMPANY_LINKED_ISSUE_IDS",
]);

const FORBIDDEN_RUNTIME_OVERRIDE_KEYS: ReadonlySet<string> = new Set([
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "NODE_OPTIONS",
  "ELECTRON_RUN_AS_NODE",
  "DYLD_INSERT_LIBRARIES",
  "LD_PRELOAD",
  "PWD",
]);

function normalizeStringEnv(input: NodeJS.ProcessEnv | Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

export function stripForbiddenRuntimeOverrides(env: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (FORBIDDEN_RUNTIME_OVERRIDE_KEYS.has(key)) {
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

export function buildSanitizedRuntimeEnv(
  hostEnv: NodeJS.ProcessEnv | Record<string, string>,
  runtimeOverrides: Record<string, string>,
): Record<string, string> {
  const normalizedHostEnv = normalizeStringEnv(hostEnv);
  const sanitized: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    if (key in normalizedHostEnv) {
      sanitized[key] = normalizedHostEnv[key]!;
    }
  }
  return {
    ...sanitized,
    ...stripForbiddenRuntimeOverrides(runtimeOverrides),
  };
}
