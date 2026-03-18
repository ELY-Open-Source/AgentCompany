export const type = "kimi_local";
export const label = "Kimi Code (local)";
export const DEFAULT_KIMI_LOCAL_MODEL = "kimi-for-coding";

export const models = [
  { id: DEFAULT_KIMI_LOCAL_MODEL, label: DEFAULT_KIMI_LOCAL_MODEL },
];

export const agentConfigurationDoc = `# kimi_local agent configuration

Adapter: kimi_local

Use when:
- You want AgentCompany to invoke the official Kimi Code CLI locally
- You accept generic CLI execution without session resume or structured transcript guarantees

Core fields:
- cwd (string, optional): absolute working directory fallback for the agent process
- promptTemplate (string, optional): prompt template rendered by AgentCompany before execution
- model (string, optional): informational only, defaults to kimi-for-coding
- command (string, optional): defaults to "kimi"
- extraArgs (string[], optional): additional CLI args
- env (object, optional): KEY=VALUE environment variables

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): graceful termination period in seconds

Notes:
- Kimi integration currently runs in generic CLI mode.
- Session resume, model discovery, graceful cancel handshakes, structured transcript, and cost attribution are not guaranteed.
- AgentCompany must surface these capability downgrades explicitly in the desktop UI.
`;
