import { runningProcesses } from "@agentcompany/adapter-utils/server-utils";
import { getConnectorDefinition } from "@main/connectors";
import type { ConnectorId, RunStatus } from "@shared/types";

const ENV_ALLOWLIST: ReadonlySet<string> = new Set([
  "PATH",
  "HOME", "USER", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TMPDIR",
  "DEVELOPER_DIR", "SDKROOT",
  "NODE_ENV", "NODE_OPTIONS",
  "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL",
  "GIT_SSH_COMMAND", "GIT_ASKPASS", "GIT_TERMINAL_PROMPT",
  "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR",
  "DISPLAY", "WAYLAND_DISPLAY", "DBUS_SESSION_BUS_ADDRESS",
  "APPDATA", "LOCALAPPDATA", "USERPROFILE", "SYSTEMROOT", "COMSPEC", "PROGRAMFILES",
  "AGENT_COMPANY_API_URL", "AGENT_COMPANY_API_KEY", "AGENT_COMPANY_RUN_ID",
]);

function buildSanitizedEnv(
  hostEnv: Record<string, string>,
  secretBindings: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    if (key in hostEnv) {
      result[key] = hostEnv[key];
    }
  }
  Object.assign(result, secretBindings);
  return result;
}

function buildRedactor(env: Record<string, string>): (text: string) => string {
  const sensitivePatterns: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (value.length < 8) continue;
    if (["PATH", "HOME", "USER", "SHELL", "LANG", "TMPDIR", "TERM"].includes(key)) continue;
    sensitivePatterns.push(value);
  }
  if (sensitivePatterns.length === 0) return (text) => text;
  sensitivePatterns.sort((a, b) => b.length - a.length);
  return (text: string) => {
    let result = text;
    for (const pattern of sensitivePatterns) {
      if (result.includes(pattern)) {
        result = result.replaceAll(pattern, "[REDACTED]");
      }
    }
    return result;
  };
}

interface RunJob {
  runId: string;
  companyId: string;
  taskId: string;
  taskTitle: string;
  taskDescription: string;
  agentId: string;
  agentName: string;
  connectorId: ConnectorId;
  workspaceId: string | null;
  workspacePath: string | null;
  workspaceMode: "exclusive" | "shared" | "none";
  command: string;
  model: string | null;
  thinkingEffort: string | null;
  env: Record<string, string>;
  sessionParams: Record<string, unknown> | null;
  systemPrompt: string | null;
  trigger: string | null;
}

type ParentMessage =
  | { type: "enqueue-run"; payload: RunJob }
  | { type: "cancel-run"; runId: string };

type ChildMessage =
  | { type: "run-log"; runId: string; stream: "stdout" | "stderr"; chunk: string }
  | { type: "run-status"; runId: string; status: RunStatus; message: string }
  | {
      type: "run-finished";
      runId: string;
      status: RunStatus;
      summary: string | null;
      errorMessage: string | null;
      exitCode: number | null;
      signal: string | null;
      model: string | null;
      sessionParams: Record<string, unknown> | null;
      sessionDisplayId: string | null;
      costUsd: number | null;
      unattributedCost: boolean;
    };

const parentPort = process.parentPort;

if (!parentPort) {
  throw new Error("AgentCompany worker requires process.parentPort");
}

const activeByAgent = new Map<string, string>();
const activeByWorkspace = new Map<string, string>();
const queue: RunJob[] = [];
const cancelledRuns = new Set<string>();

function post(message: ChildMessage) {
  parentPort.postMessage(message);
}

function workspaceKey(job: RunJob) {
  if (job.workspaceMode !== "exclusive") {
    return null;
  }
  return job.workspaceId ?? job.workspacePath ?? `task:${job.taskId}`;
}

function enqueue(job: RunJob) {
  queue.push(job);
  post({
    type: "run-status",
    runId: job.runId,
    status: "queued",
    message: "Run queued in orchestration worker.",
  });
  void maybeStartQueuedRuns();
}

async function maybeStartQueuedRuns() {
  const readyJobs = [...queue];
  for (const job of readyJobs) {
    if (activeByAgent.has(job.agentId)) continue;
    const lockKey = workspaceKey(job);
    if (lockKey && activeByWorkspace.has(lockKey)) continue;
    const index = queue.findIndex((entry) => entry.runId === job.runId);
    if (index >= 0) queue.splice(index, 1);
    void startRun(job);
  }
}

async function startRun(job: RunJob) {
  const definition = getConnectorDefinition(job.connectorId);
  const lockKey = workspaceKey(job);
  activeByAgent.set(job.agentId, job.runId);
  if (lockKey) {
    activeByWorkspace.set(lockKey, job.runId);
  }
  post({
    type: "run-status",
    runId: job.runId,
    status: "running",
    message: `Running with ${definition.label}.`,
  });

  const sanitizedEnv = buildSanitizedEnv(
    Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"),
    ),
    job.env,
  );

  const redact = buildRedactor(job.env);

  try {
    const result = await definition.module.execute({
      runId: job.runId,
      agent: {
        id: job.agentId,
        companyId: job.companyId,
        name: job.agentName,
        adapterType: job.connectorId,
        adapterConfig: {},
      },
      runtime: {
        sessionId:
          typeof job.sessionParams?.sessionId === "string" ? job.sessionParams.sessionId : null,
        sessionParams: job.sessionParams,
        sessionDisplayId:
          typeof job.sessionParams?.sessionId === "string" ? job.sessionParams.sessionId : null,
        taskKey: job.taskId,
      },
      config: {
        command: job.command,
        cwd: job.workspacePath ?? process.cwd(),
        model: job.model,
        env: sanitizedEnv,
        effort: job.connectorId === "claude_local" ? (job.thinkingEffort ?? "") : "",
        modelReasoningEffort: job.connectorId === "codex_local" ? (job.thinkingEffort ?? "") : "",
        dangerouslySkipPermissions: true,
        dangerouslyBypassApprovalsAndSandbox: true,
        extraArgs: job.connectorId === "codex_local" ? ["--skip-git-repo-check"] : [],
      },
      context: {
        taskId: job.taskId,
        taskTitle: job.systemPrompt ?? job.taskTitle,
        taskDescription: job.systemPrompt ? "" : job.taskDescription,
        agentCompanyWorkspace: job.workspaceId || job.workspacePath ? {
          workspaceId: job.workspaceId ?? "",
          cwd: job.workspacePath ?? "",
          source: "agent_company",
        } : undefined,
      },
      onLog: async (stream, chunk) => {
        post({
          type: "run-log",
          runId: job.runId,
          stream,
          chunk: redact(chunk),
        });
      },
    });

    const cancelled = cancelledRuns.has(job.runId);
    const finalStatus = cancelled
      ? "cancelled"
      : result.timedOut
        ? "timed_out"
        : result.errorMessage || result.exitCode
          ? "failed"
          : "succeeded";

    post({
      type: "run-finished",
      runId: job.runId,
      status: finalStatus,
      summary: result.summary ?? null,
      errorMessage: result.errorMessage ?? null,
      exitCode: result.exitCode,
      signal: result.signal,
      model: result.model ?? job.model,
      sessionParams: result.sessionParams ?? null,
      sessionDisplayId: result.sessionDisplayId ?? null,
      costUsd: typeof result.costUsd === "number" ? result.costUsd : null,
      unattributedCost: !result.costUsd,
    });
  } catch (error) {
    post({
      type: "run-finished",
      runId: job.runId,
      status: cancelledRuns.has(job.runId) ? "cancelled" : "failed",
      summary: null,
      errorMessage: error instanceof Error ? error.message : String(error),
      exitCode: null,
      signal: null,
      model: job.model,
      sessionParams: null,
      sessionDisplayId: null,
      costUsd: null,
      unattributedCost: true,
    });
  } finally {
    cancelledRuns.delete(job.runId);
    activeByAgent.delete(job.agentId);
    if (lockKey) {
      activeByWorkspace.delete(lockKey);
    }
    void maybeStartQueuedRuns();
  }
}

function cancelRun(runId: string) {
  const queuedIndex = queue.findIndex((entry) => entry.runId === runId);
  if (queuedIndex >= 0) {
    queue.splice(queuedIndex, 1);
    post({
      type: "run-finished",
      runId,
      status: "cancelled",
      summary: "Cancelled before execution.",
      errorMessage: null,
      exitCode: null,
      signal: null,
      model: null,
      sessionParams: null,
      sessionDisplayId: null,
      costUsd: null,
      unattributedCost: true,
    });
    return;
  }

  cancelledRuns.add(runId);
  const running = runningProcesses.get(runId);
  if (running) {
    running.child.kill("SIGTERM");
  }
}

parentPort.on("message", (event) => {
  const message = event.data as ParentMessage;
  if (message.type === "enqueue-run") {
    enqueue(message.payload);
    return;
  }
  if (message.type === "cancel-run") {
    cancelRun(message.runId);
  }
});
