import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  protocol,
  net,
  session,
  shell,
  utilityProcess,
} from "electron";
import electronUpdater from "electron-updater";
import log from "electron-log/main.js";
import { z } from "zod";
import {
  IPC_CHANNELS,
  approvalDecisionSchema,
  approvalInputSchema,
  agentInputSchema,
  cancelRunSchema,
  commentInputSchema,
  companyInputSchema,
  connectorInputSchema,
  deleteEntitySchema,
  goalInputSchema,
  heartbeatSettingsSchema,
  listCommentsSchema,
  type DesktopResult,
  projectInputSchema,
  runLogSchema,
  secretInputSchema,
  settingsSchema,
  startRunSchema,
  taskInputSchema,
  triggerHeartbeatSchema,
  workspaceInputSchema,
} from "@shared/contracts";
import type { DesktopEvent } from "@shared/types";
import { getConnectorDefinition } from "./connectors";
import { AppDatabase } from "./database";
import { AgentApiServer } from "./api-server";
import { createAgentToken } from "./agent-auth";
import { buildTaskPrompt } from "./prompt-builder";

app.name = "AgentCompany";

// ── Fix PATH for packaged macOS/Linux apps ──────────────────────────────────
// Packaged Electron apps on macOS launched from Finder inherit a minimal PATH
// (/usr/bin:/bin:/usr/sbin:/sbin) that doesn't include Homebrew, nvm, cargo, etc.
// We prepend common installation directories so connectors like claude, codex,
// gemini, opencode, kimi can be found.
{
  const extra = [
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    `${process.env.HOME}/.local/bin`,
    `${process.env.HOME}/.cargo/bin`,
    `${process.env.HOME}/.nvm/current/bin`,
    `${process.env.HOME}/.volta/bin`,
    `${process.env.HOME}/.bun/bin`,
    "/usr/local/sbin",
    // Common Linux snap/flatpak paths
    "/snap/bin",
  ].filter((p) => p && !p.includes("undefined"));
  const current = process.env.PATH ?? "";
  const existing = new Set(current.split(":").filter(Boolean));
  const toAdd = extra.filter((p) => !existing.has(p));
  if (toAdd.length > 0) {
    process.env.PATH = [...toAdd, current].join(":");
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRELOAD_PATH = join(__dirname, "../preload/index.js");
const RENDERER_DIST = join(__dirname, "../renderer");
const WORKER_PATH = join(__dirname, "worker.js");
const ICON_PATH = resolve(__dirname, "../../assets/icon.png");
const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const devServerOrigin = process.env.ELECTRON_RENDERER_URL ? new URL(process.env.ELECTRON_RENDERER_URL).origin : null;
const { autoUpdater } = electronUpdater;

let mainWindow: BrowserWindow | null = null;
let db: AppDatabase;
let worker: ReturnType<typeof utilityProcess.fork> | null = null;
let apiServer: AgentApiServer | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let isQuitting = false;
let backgroundCloseNoticeShown = false;

const companyIdSchema = z.string().uuid();
const runStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "cancelled", "timed_out", "interrupted"]);
const workerMessageSchema = z.union([
  z.object({
    type: z.literal("run-log"),
    runId: z.string().uuid(),
    stream: z.enum(["stdout", "stderr"]),
    chunk: z.string(),
  }),
  z.object({
    type: z.literal("run-status"),
    runId: z.string().uuid(),
    status: runStatusSchema,
    message: z.string(),
  }),
  z.object({
    type: z.literal("run-finished"),
    runId: z.string().uuid(),
    status: runStatusSchema,
    summary: z.string().nullable(),
    errorMessage: z.string().nullable(),
    exitCode: z.number().int().nullable(),
    signal: z.string().nullable(),
    model: z.string().nullable(),
    sessionParams: z.record(z.string(), z.unknown()).nullable(),
    sessionDisplayId: z.string().nullable(),
    costUsd: z.number().nullable(),
    unattributedCost: z.boolean(),
  }),
]);

type CompanyScopedTable = "workspaces" | "agents" | "goals" | "projects" | "tasks" | "approvals" | "runs" | "secrets";

function ok<T>(data: T): DesktopResult<T> {
  return { ok: true, data };
}

function fail(code: string, message: string): DesktopResult<never> {
  return { ok: false, error: { code, message } };
}

function isTrustedRendererUrl(url: string) {
  if (!url) {
    return false;
  }
  if (isDev) {
    return devServerOrigin ? url.startsWith(devServerOrigin) : false;
  }
  return url.startsWith("app://-");
}

function registerHandle(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<DesktopResult<unknown>> | DesktopResult<unknown>,
) {
  ipcMain.handle(channel, async (event, ...args) => {
    const senderUrl = event.senderFrame?.url ?? event.sender.getURL();
    if (!isTrustedRendererUrl(senderUrl)) {
      log.error(`[ipc:${channel}] blocked untrusted sender ${senderUrl || "<empty>"}`);
      return fail("IPC_FORBIDDEN", "IPC sender is not allowed.");
    }
    try {
      return await handler(event, ...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`[ipc:${channel}] ${message}`);
      return fail("IPC_HANDLER_FAILED", message);
    }
  });
}

function emitEvent(event: DesktopEvent) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.rendererEvent, event);
  }
}

function ensureCompanyExists(companyId: string) {
  return db.hasCompany(companyId)
    ? null
    : fail("COMPANY_NOT_FOUND", "The selected company no longer exists.");
}

function findInvalidReference(
  companyId: string,
  refs: Array<{ id: string | null | undefined; table: CompanyScopedTable; label: string }>,
) {
  return refs.find((ref) => ref.id && !db.belongsToCompany(ref.table, ref.id, companyId)) ?? null;
}

function publishDomainChanged() {
  emitEvent({ type: "domain-changed" });
}

function notify(title: string, body: string) {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

function buildMenu() {
  const macAppMenu: Electron.MenuItemConstructorOptions = {
    label: app.name,
    submenu: [
      { role: "about" },
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  };
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [macAppMenu] : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open Workspace Folder",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            const result = await dialog.showOpenDialog({
              properties: ["openDirectory"],
            });
            if (result.canceled || result.filePaths.length === 0) return;
            shell.openPath(result.filePaths[0] ?? "");
          },
        },
        { type: "separator" },
        {
          label: "Backup Profile",
          accelerator: "CmdOrCtrl+Shift+B",
          click: async () => {
            const target = await dialog.showOpenDialog({
              properties: ["openDirectory", "createDirectory"],
            });
            if (target.canceled || target.filePaths.length === 0) return;
            await db.exportBackup(join(target.filePaths[0]!, `agentcompany-backup-${Date.now()}`));
          },
        },
        ...(process.platform === "darwin" ? [] : [{ type: "separator" as const }, { role: "quit" as const }]),
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Command Palette",
          accelerator: "CmdOrCtrl+K",
          click: () => emitEvent({ type: "shortcut", action: "toggle-command-palette" }),
        },
        {
          label: "Toggle Console",
          accelerator: "CmdOrCtrl+`",
          click: () => emitEvent({ type: "shortcut", action: "toggle-console" }),
        },
        {
          label: "Refresh Data",
          accelerator: "CmdOrCtrl+R",
          click: () => emitEvent({ type: "shortcut", action: "refresh" }),
        },
        { type: "separator" },
        { role: "toggleDevTools", visible: isDev },
      ],
    },
    {
      label: "Run",
      submenu: [
        {
          label: "Check For Updates",
          click: async () => {
            await checkForUpdates();
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function installSecurityGuards() {
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-attach-webview", (event) => {
      event.preventDefault();
    });
    contents.on("will-navigate", (event) => {
      event.preventDefault();
    });
  });
}

function registerProtocol() {
  protocol.handle("app", (request) => {
    const url = new URL(request.url);
    const relativePath = decodeURIComponent(url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, ""));
    const targetPath = resolve(RENDERER_DIST, relativePath);
    if (!targetPath.startsWith(RENDERER_DIST) || !existsSync(targetPath)) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(targetPath).toString());
  });
}

async function createWindow() {
  const windowIcon = nativeImage.createFromPath(ICON_PATH);
  mainWindow = new BrowserWindow({
    title: "AgentCompany",
    icon: windowIcon.isEmpty() ? undefined : windowIcon,
    width: 1480,
    height: 980,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#13110f",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: isDev,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  if (isDev) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL!);
  } else {
    await mainWindow.loadURL("app://-/index.html");
  }
  mainWindow.on("close", (event) => {
    if (process.platform === "darwin" || isQuitting) {
      return;
    }
    event.preventDefault();
    mainWindow?.hide();
    if (!backgroundCloseNoticeShown) {
      backgroundCloseNoticeShown = true;
      notify("AgentCompany is still running", "Automation continues in the background until you quit the app.");
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createWorker() {
  worker = utilityProcess.fork(WORKER_PATH, [], {
    stdio: "pipe",
    serviceName: "AgentCompany Orchestrator",
  });

  worker.stdout?.on("data", (chunk) => log.info(`[worker] ${String(chunk).trim()}`));
  worker.stderr?.on("data", (chunk) => log.error(`[worker] ${String(chunk).trim()}`));

  // Step 7: Worker crash recovery
  worker.on("exit", (code) => {
    if (isQuitting) return;

    log.warn(`[worker] Worker exited with code ${code}, recovering...`);

    // Separate running runs (truly executing — mark interrupted) from queued runs
    // (never started — eligible for re-enqueue after worker restarts).
    const snapshot = db.listSnapshot();
    const affectedAgentIds = new Set<string>();
    const requeueCandidates: Array<{ id: string; taskId: string; agentId: string; companyId: string; workspaceId: string | null; connectorId: string }> = [];

    for (const run of snapshot.runs) {
      if (run.status === "running") {
        // Running runs were actually executing — mark interrupted
        db.finishRun({
          runId: run.id,
          status: "interrupted",
          summary: "Worker process crashed.",
          errorMessage: "Worker process exited unexpectedly.",
          exitCode: code,
          signal: null,
          model: null,
          sessionDisplayId: null,
          costUsd: null,
          unattributedCost: true,
        });
        if (run.workspaceId) {
          db.releaseWorkspaceLock(run.workspaceId, run.id);
        }
        affectedAgentIds.add(run.agentId);

        const chain = db.getChainOfCommand(run.agentId);
        if (chain.length > 0) {
          wakeAgentIfPossible(chain[0].id, run.companyId, "report_failed");
        }
      } else if (run.status === "queued") {
        // Queued runs never started — collect for re-enqueue
        requeueCandidates.push({
          id: run.id,
          taskId: run.taskId,
          agentId: run.agentId,
          companyId: run.companyId,
          workspaceId: run.workspaceId,
          connectorId: run.connectorId,
        });
      }
    }

    // Drain deferred wakes for affected agents
    for (const agentId of affectedAgentIds) {
      const pendingWakes = db.consumePendingWakes(agentId);
      if (pendingWakes.length > 0) {
        const wake = pendingWakes[0];
        wakeAgentIfPossible(agentId, wake.companyId, wake.trigger);
      }
    }

    publishDomainChanged();

    // Restart the worker, then re-enqueue queued runs that never started
    createWorker();

    if (requeueCandidates.length > 0 && worker) {
      log.info(`[worker] Re-enqueuing ${requeueCandidates.length} queued run(s) after worker restart.`);
      const recoverySnapshot = db.listSnapshot();
      for (const candidate of requeueCandidates) {
        try {
          const task = db.getTask(candidate.taskId);
          const agent = db.getAgent(candidate.agentId);
          const connector = db.getConnector(agent.connectorId as import("@shared/types").ConnectorId);
          const workspace = db.getWorkspace(candidate.workspaceId);
          const env = db.resolveSecretEnv(connector.envBindingText, candidate.companyId);
          const session = db.getTaskSession(task.id);

          // Build systemPrompt exactly like the normal heartbeat path
          const recoveryApiPort = apiServer?.getPort() ?? 0;
          const recoveryApiUrl = recoveryApiPort ? `http://127.0.0.1:${recoveryApiPort}` : "";
          const recoveryApiKey = recoveryApiUrl ? createAgentToken(agent.id, candidate.companyId, candidate.id) : "";

          const recoveryPrompt = recoveryApiUrl ? buildTaskPrompt({
            agent,
            apiUrl: recoveryApiUrl,
            apiKey: recoveryApiKey,
            runId: candidate.id,
            task,
            companyName: recoverySnapshot.companies.find((c) => c.id === candidate.companyId)?.name ?? "Company",
            goals: recoverySnapshot.goals.filter((g) => g.companyId === candidate.companyId),
            projects: recoverySnapshot.projects.filter((p) => p.companyId === candidate.companyId),
            directReports: db.getDirectReports(agent.id, candidate.companyId),
            chainOfCommand: db.getChainOfCommand(agent.id),
            assignedTasks: db.listAgentTasks(agent.id, candidate.companyId, ["todo", "in_progress", "blocked"]),
            allAgents: recoverySnapshot.agents.filter((a) => a.companyId === candidate.companyId),
            pendingApprovals: recoverySnapshot.approvals.filter(
              (a) => a.companyId === candidate.companyId &&
                a.requestedByAgentId === agent.id &&
                (a.state === "pending" || a.state === "revision_requested"),
            ),
            tasksAwaitingReview: db.listReviewTasksForManager(agent.id, candidate.companyId),
            wakeReason: "recovery",
          }) : null;

          // Inject API credentials exactly like the normal path
          if (recoveryApiUrl) {
            env.AGENT_COMPANY_API_URL = recoveryApiUrl;
            env.AGENT_COMPANY_API_KEY = recoveryApiKey;
            env.AGENT_COMPANY_AGENT_ID = agent.id;
            env.AGENT_COMPANY_COMPANY_ID = candidate.companyId;
            env.AGENT_COMPANY_RUN_ID = candidate.id;
            env.AGENT_COMPANY_TASK_ID = task.id;
            env.AGENT_COMPANY_WAKE_REASON = "recovery";
          }

          // Parse thinkingEffort exactly like the normal path
          let recoveryThinkingEffort: string | null = null;
          try {
            const meta = JSON.parse(agent.metadataJson || "{}");
            if (typeof meta.thinkingEffort === "string" && meta.thinkingEffort) {
              recoveryThinkingEffort = meta.thinkingEffort;
            }
          } catch { /* ignore malformed json */ }

          worker.postMessage({
            type: "enqueue-run",
            payload: {
              runId: candidate.id,
              companyId: candidate.companyId,
              taskId: task.id,
              taskTitle: task.title,
              taskDescription: task.description,
              agentId: agent.id,
              agentName: agent.name,
              connectorId: agent.connectorId,
              workspaceId: workspace?.id ?? null,
              workspacePath: workspace?.localPath ?? null,
              command: connector.command,
              model: connector.model ?? agent.model,
              thinkingEffort: recoveryThinkingEffort,
              env,
              sessionParams: session.sessionParams,
              systemPrompt: recoveryPrompt,
              trigger: "recovery",
            },
          });
        } catch (error) {
          // Re-enqueue failed — mark interrupted AND release workspace lock
          log.warn(`[worker] Failed to re-enqueue run ${candidate.id}: ${error instanceof Error ? error.message : String(error)}`);
          db.finishRun({
            runId: candidate.id,
            status: "interrupted",
            summary: "Could not re-enqueue after worker restart.",
            errorMessage: error instanceof Error ? error.message : String(error),
            exitCode: null,
            signal: null,
            model: null,
            sessionDisplayId: null,
            costUsd: null,
            unattributedCost: true,
          });
          if (candidate.workspaceId) {
            db.releaseWorkspaceLock(candidate.workspaceId, candidate.id);
          }
        }
      }
    }
  });

  worker.on("message", async (message) => {
    let event: z.infer<typeof workerMessageSchema>;
    try {
      event = workerMessageSchema.parse(message);
    } catch (error) {
      log.error("[worker] invalid message payload", error);
      return;
    }

    if (event.type === "run-log") {
      await db.appendRunLog(event.runId, event.stream, event.chunk);
      emitEvent(event);
      return;
    }

    if (event.type === "run-status") {
      db.markRunStatus(event.runId, event.status, event.message);
      emitEvent(event);
      publishDomainChanged();
      return;
    }

    const snapshot = db.listSnapshot();
    const run = snapshot.runs.find((entry) => entry.id === event.runId);
    if (run) {
      const connector = getConnectorDefinition(run.connectorId);

      // Guard: task/agent may have been deleted while the run was active
      let task: ReturnType<typeof db.getTask> | null = null;
      try { task = db.getTask(run.taskId); } catch { /* task deleted mid-run */ }

      if (task) {
        if (event.sessionParams && connector.module.sessionCodec) {
          const serialized = connector.module.sessionCodec.serialize(event.sessionParams);
          db.updateTaskSession(task.id, serialized, connector.module.sessionCodec.getDisplayId?.(serialized ?? null) ?? event.sessionDisplayId ?? null);
        }
        if (!event.sessionParams) {
          db.updateTaskSession(task.id, null, null);
        }
      }

      const runOutcome = db.finishRun(event);
      // Release workspace lock now that the run is finished
      if (run.workspaceId) {
        db.releaseWorkspaceLock(run.workspaceId, run.id);
      }
      db.addActivity({
        companyId: run.companyId,
        actor: run.agentId,
        action: `run.${event.status}`,
        entityType: "run",
        entityId: run.id,
        detail: event.summary ?? event.errorMessage ?? "",
      });
      publishDomainChanged();
      emitEvent({
        type: "run-status",
        runId: run.id,
        status: event.status,
        message: event.summary ?? event.errorMessage ?? event.status,
      });
      if ((event.status === "failed" || event.status === "timed_out" || event.status === "interrupted") && task) {
        notify("Run attention required", task.title);
      }

      // Guard: agent may have been deleted while the run was active
      let updatedAgent: ReturnType<typeof db.getAgent> | null = null;
      try { updatedAgent = db.getAgent(run.agentId); } catch { /* agent deleted mid-run */ }

      if (updatedAgent && runOutcome.budgetHardStopped) {
        autoPauseBudgetExceededAgent(updatedAgent);
      }

      // Step 6: Run failure escalation — wake agent's manager via org hierarchy
      if (event.status === "failed" || event.status === "timed_out") {
        try {
          const chain = db.getChainOfCommand(run.agentId);
          if (chain.length > 0) {
            wakeAgentIfPossible(chain[0].id, run.companyId, "report_failed");
          }
        } catch { /* agent deleted, skip escalation */ }
      }

      // Step 3c: Consume deferred wakes — re-wake agent for each pending trigger
      const pendingWakes = db.consumePendingWakes(run.agentId);
      if (pendingWakes.length > 0) {
        // Process the first wake immediately; additional wakes will be
        // re-enqueued by wakeAgentIfPossible if the agent is still busy.
        for (const wake of pendingWakes) {
          wakeAgentIfPossible(run.agentId, wake.companyId, wake.trigger);
        }
      }
    }
  });
}

function parseVersion(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(command, ["--version"], {
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      buffer += String(chunk);
    });
    child.on("error", () => resolve(null));
    child.on("close", () => {
      const versionLine = buffer.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
      resolve(versionLine);
    });
  });
}

async function checkConnector(id: Parameters<typeof db.getConnector>[0]) {
  const connector = db.getConnector(id);
  const definition = getConnectorDefinition(id);

  // Set "detected" (checking) state immediately so the UI shows progress
  db.updateConnectorHealth({
    id,
    status: "detected",
    authState: connector.authState,
    version: connector.version,
    lastError: null,
  });
  publishDomainChanged();

  const result = await definition.module.testEnvironment({
    companyId: db.getCurrentCompanyId() ?? randomFallbackCompanyId(),
    adapterType: id,
    config: {
      command: connector.command,
      model: connector.model,
      cwd: process.cwd(),
      // These flags allow the health probe to run non-interactively.
      // Without them, CLIs like Codex/Gemini enter interactive approval mode
      // and the probe hangs or fails.
      dangerouslyBypassApprovalsAndSandbox: true,  // Codex
      dangerouslySkipPermissions: true,              // Claude
      approvalMode: "yolo",                          // Gemini
      sandbox: false,                                // Gemini
      yolo: true,                                    // Gemini fallback
      extraArgs: id === "codex_local" ? ["--skip-git-repo-check"] : [],
    },
  });

  const authState =
    result.checks.some((check) => check.code.includes("auth") || check.code.includes("login"))
      ? result.status === "fail"
        ? "required"
        : "ok"
      : result.status === "fail"
        ? "error"
        : "ok";
  const version = await parseVersion(connector.command);

  // Map adapter status to connector state: pass/warn → ready, fail → error/auth_required
  // "warn" means the connector works but has non-fatal issues (e.g. missing API key that
  // might be set at runtime) — still usable, so map to "ready" not "degraded"
  db.updateConnectorHealth({
    id,
    status:
      result.status === "pass" || result.status === "warn"
        ? "ready"
        : authState === "required"
          ? "auth_required"
          : "error",
    authState,
    version,
    lastError: result.status === "fail" ? result.checks.map((check) => check.message).join(" | ") : null,
  });
  db.addActivity({
    companyId: db.getCurrentCompanyId() ?? randomFallbackCompanyId(),
    actor: "system",
    action: "connector.tested",
    entityType: "connector",
    entityId: id,
    detail: result.status,
  });
  publishDomainChanged();
}

function randomFallbackCompanyId() {
  const snapshot = db.listSnapshot();
  return snapshot.companies[0]?.id ?? "00000000-0000-0000-0000-000000000000";
}

function autoPauseBudgetExceededAgent(agent: { id: string; companyId: string; name: string; spentMonthlyUsd: number; budgetMonthlyUsd: number }) {
  if (!(agent.budgetMonthlyUsd > 0) || agent.spentMonthlyUsd < agent.budgetMonthlyUsd) {
    return false;
  }
  db.addActivity({
    companyId: agent.companyId,
    actor: "system",
    action: "agent.auto_paused",
    entityType: "agent",
    entityId: agent.id,
    detail: `Budget exhausted at ${agent.spentMonthlyUsd.toFixed(2)} / ${agent.budgetMonthlyUsd.toFixed(2)} USD.`,
  });
  notify("Agent paused for budget limit", agent.name);
  publishDomainChanged();
  return true;
}

function ensureAgentHeartbeatEnabled(agentId: string) {
  const agent = db.getAgent(agentId);
  if (!agent.heartbeatEnabled) {
    db.setHeartbeat(agentId, true, agent.heartbeatIntervalSec || 120);
  }
}

function wakeAgentIfPossible(agentId: string | null | undefined, companyId: string, trigger: string) {
  if (!agentId) return null;
  try {
    ensureAgentHeartbeatEnabled(agentId);
  } catch {
    return null;
  }

  // Check if agent is specifically busy (has active run) before attempting wake.
  // Only enqueue deferred wakes for the "busy" case, not for other skip reasons
  // (inactive company, paused agent, budget exhaustion, connector not ready).
  const snapshot = db.listSnapshot();
  const hasActiveRun = snapshot.runs.some(
    (run) => run.companyId === companyId && run.agentId === agentId && (run.status === "queued" || run.status === "running"),
  );

  const runId = startAgentHeartbeatRun(agentId, companyId, trigger);
  if (!runId && hasActiveRun) {
    // Agent is busy with an active run — defer the wake so it's not lost
    db.enqueuePendingWake(companyId, agentId, trigger);
  }
  return runId;
}

function getRunEligibilityFailure(
  agent: { status: string; budgetMonthlyUsd: number; spentMonthlyUsd: number; name: string; connectorId: string; id: string; companyId: string },
  connector: { id: string; status: string },
) {
  if (["terminated", "paused", "pending_approval"].includes(agent.status)) {
    return "AGENT_NOT_RUNNABLE";
  }
  if (agent.budgetMonthlyUsd > 0 && agent.spentMonthlyUsd >= agent.budgetMonthlyUsd) {
    autoPauseBudgetExceededAgent(agent);
    log.info(`[run] Agent ${agent.name} budget exhausted, skipping`);
    return "AGENT_BUDGET_EXHAUSTED";
  }
  if (connector.status !== "ready" && connector.status !== "degraded") {
    log.info(`[run] Agent ${agent.name} connector ${connector.id} not ready (${connector.status})`);
    return "CONNECTOR_NOT_READY";
  }
  return null;
}

function startAgentHeartbeatRun(agentId: string, companyId: string, trigger: string): string | null {
  if (!worker) return null;
  const snapshot = db.listSnapshot();
  const company = snapshot.companies.find((entry) => entry.id === companyId) ?? null;
  if (!company || company.status !== "active") {
    log.info(`[heartbeat] Skipping ${agentId} because company ${companyId} is not active.`);
    return null;
  }
  const agent = db.getAgent(agentId);
  const connector = db.getConnector(agent.connectorId);
  if (getRunEligibilityFailure(agent, connector)) {
    return null;
  }
  if (
    snapshot.runs.some(
      (run) => run.companyId === companyId && run.agentId === agent.id && (run.status === "queued" || run.status === "running"),
    )
  ) {
    log.info(`[heartbeat] Skipping ${agent.name} because it already has an active run.`);
    return null;
  }

  // Phase 3: Approval hard gate — don't start heartbeat runs for pending-approval agents
  if (db.isAgentPendingApproval(agentId)) {
    log.info(`[heartbeat] Skipping ${agent.name} because agent is pending hire approval.`);
    return null;
  }

  // Find an existing assigned task to run against
  const assignedTasks = db.listAgentTasks(agentId, companyId, ["todo", "in_progress", "blocked"]);

  // For timer-triggered heartbeats, only pick up real user-created tasks (not old heartbeat tasks)
  const isTimer = trigger === "timer";
  const candidateTasks = isTimer
    ? assignedTasks.filter((entry) => !entry.title.startsWith("[Heartbeat]"))
    : assignedTasks;

  let task = candidateTasks.find((entry) => !entry.activeRunId) ?? null;

  if (!task) {
    const hasActiveAssignedRun = candidateTasks.some(
      (entry) =>
        entry.activeRunId &&
        snapshot.runs.some(
          (run) => run.id === entry.activeRunId && run.companyId === companyId && (run.status === "queued" || run.status === "running"),
        ),
    );
    if (hasActiveAssignedRun) {
      return null;
    }
    // Timer should never create new heartbeat tasks — only explicit triggers can
    if (isTimer) {
      log.info(`[heartbeat] Skipping ${agent.name} — no actionable tasks and trigger is timer.`);
      return null;
    }
    // Create a heartbeat check task (inherit workspace from agent)
    const taskId = db.saveTask({
      companyId,
      title: `[Heartbeat] ${agent.name} — Check for work`,
      description: `Automated heartbeat run for ${agent.name}. Review assigned tasks, check goals, and take action as needed.`,
      assigneeAgentId: agentId,
      workspaceId: agent.workspaceId ?? undefined,
      status: "in_progress",
      priority: "medium",
    });
    task = db.getTask(taskId);
  }
  if (
    task.activeRunId ||
    snapshot.runs.some(
      (run) => run.taskId === task.id && run.companyId === companyId && (run.status === "queued" || run.status === "running"),
    )
  ) {
    log.info(`[heartbeat] Skipping ${agent.name} because task ${task.title} already has an active run.`);
    return null;
  }

  const workspace =
    db.getWorkspace(task.workspaceId) ??
    db.getWorkspace(agent.workspaceId) ??
    db.getProjectPrimaryWorkspace(companyId) ??
    db.getAnyCompanyWorkspace(companyId);

  log.info(
    `[heartbeat] Workspace resolution for ${agent.name}: task.workspaceId=${task.workspaceId ?? "null"}, agent.workspaceId=${agent.workspaceId ?? "null"}, resolved=${workspace?.name ?? "NONE"}, localPath=${workspace?.localPath ?? "NONE"}`,
  );

  // Attempt workspace lock BEFORE creating the run — if another run holds it, defer
  if (workspace && !db.acquireWorkspaceLock(workspace.id, `pre-check-${agent.id}`)) {
    log.info(`[heartbeat] Skipping ${agent.name} because workspace ${workspace.name} is locked by another run.`);
    // Release the pre-check placeholder
    db.releaseWorkspaceLock(workspace.id, `pre-check-${agent.id}`);
    return null;
  }
  // Release pre-check — the real lock will be acquired with the actual run ID below
  if (workspace) {
    db.releaseWorkspaceLock(workspace.id, `pre-check-${agent.id}`);
  }

  const run = db.createRun({
    companyId,
    taskId: task.id,
    agentId: agent.id,
    workspaceId: workspace?.id ?? null,
    connectorId: connector.id,
  });

  // Acquire workspace lock with the real run ID
  if (workspace) {
    const locked = db.acquireWorkspaceLock(workspace.id, run.id);
    if (!locked) {
      // Race condition: someone else grabbed the lock between pre-check and here
      log.warn(`[heartbeat] Workspace lock race for ${workspace.name}, aborting run ${run.id}`);
      db.finishRun({ runId: run.id, status: "cancelled", summary: "Workspace lock contention.", errorMessage: null, exitCode: null, signal: null, model: null, sessionDisplayId: null, costUsd: null, unattributedCost: true });
      return null;
    }
  }

  const env = db.resolveSecretEnv(connector.envBindingText, companyId);

  // Build rich prompt with API context
  const apiPort = apiServer?.getPort() ?? 0;
  const apiUrl = apiPort ? `http://127.0.0.1:${apiPort}` : "";
  const apiKey = apiUrl ? createAgentToken(agent.id, companyId, run.id) : "";

  const systemPrompt = apiUrl ? buildTaskPrompt({
    agent,
    apiUrl,
    apiKey,
    runId: run.id,
    task,
    companyName: company.name,
    goals: snapshot.goals.filter((g) => g.companyId === companyId),
    projects: snapshot.projects.filter((p) => p.companyId === companyId),
    directReports: db.getDirectReports(agent.id, companyId),
    chainOfCommand: db.getChainOfCommand(agent.id),
    assignedTasks: assignedTasks,
    allAgents: snapshot.agents.filter((a) => a.companyId === companyId),
    pendingApprovals: snapshot.approvals.filter(
      (a) => a.companyId === companyId &&
        a.requestedByAgentId === agent.id &&
        (a.state === "pending" || a.state === "revision_requested"),
    ),
    tasksAwaitingReview: db.listReviewTasksForManager(agent.id, companyId),
    wakeReason: trigger,
  }) : null;

  // Add API credentials to env
  if (apiUrl) {
    env.AGENT_COMPANY_API_URL = apiUrl;
    env.AGENT_COMPANY_API_KEY = apiKey;
    env.AGENT_COMPANY_AGENT_ID = agent.id;
    env.AGENT_COMPANY_COMPANY_ID = companyId;
    env.AGENT_COMPANY_RUN_ID = run.id;
    env.AGENT_COMPANY_TASK_ID = task.id;
    env.AGENT_COMPANY_WAKE_REASON = trigger;
  }

  const session = db.getTaskSession(task.id);
  let thinkingEffort: string | null = null;
  try {
    const meta = JSON.parse(agent.metadataJson || "{}");
    if (typeof meta.thinkingEffort === "string" && meta.thinkingEffort) {
      thinkingEffort = meta.thinkingEffort;
    }
  } catch { /* ignore malformed json */ }

  worker.postMessage({
    type: "enqueue-run",
    payload: {
      runId: run.id,
      companyId,
      taskId: task.id,
      taskTitle: task.title,
      taskDescription: task.description,
      agentId: agent.id,
      agentName: agent.name,
      connectorId: connector.id,
      workspaceId: workspace?.id ?? null,
      workspacePath: workspace?.localPath ?? null,
      command: connector.command,
      model: connector.model ?? agent.model,
      thinkingEffort,
      env,
      sessionParams: session.sessionParams,
      systemPrompt,
      trigger,
    },
  });

  db.markHeartbeatAt(agentId);
  db.addActivity({
    companyId,
    actor: "system",
    action: "heartbeat.triggered",
    entityType: "agent",
    entityId: agent.id,
    detail: `${trigger} heartbeat for ${agent.name}`,
  });
  publishDomainChanged();
  return run.id;
}

function startHeartbeatScheduler() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);

  heartbeatTimer = setInterval(() => {
    try {
      const snapshot = db.listSnapshot();
      const now = Date.now();

      for (const company of snapshot.companies.filter((entry) => entry.status === "active")) {
        try {
          const eligibleAgents = db.listHeartbeatEligibleAgents(company.id);
          for (const agent of eligibleAgents) {
            const hasActiveRun = snapshot.runs.some(
              (r) => r.agentId === agent.id && (r.status === "running" || r.status === "queued"),
            );
            if (hasActiveRun) continue;

            const lastHeartbeat = agent.lastHeartbeatAt ? new Date(agent.lastHeartbeatAt).getTime() : 0;
            const intervalMs = agent.heartbeatIntervalSec * 1000;
            if (now - lastHeartbeat < intervalMs) continue;

            log.info(`[heartbeat] Waking agent ${agent.name} (interval: ${agent.heartbeatIntervalSec}s)`);
            startAgentHeartbeatRun(agent.id, company.id, "timer");
          }
        } catch (companyError) {
          log.error(`[heartbeat] Error processing company ${company.id}: ${companyError instanceof Error ? companyError.message : String(companyError)}`);
        }
      }
    } catch (error) {
      log.error(`[heartbeat] Scheduler error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, 15_000); // Check every 15 seconds
}

function registerHandlers() {
  registerHandle(IPC_CHANNELS.loadSnapshot, async () => ok(db.listSnapshot()));

  registerHandle(IPC_CHANNELS.pickDirectory, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
    });
    return ok(result.canceled ? null : (result.filePaths[0] ?? null));
  });

  registerHandle(IPC_CHANNELS.openPath, async (_event, targetPath) => {
    if (typeof targetPath !== "string" || targetPath.length === 0) {
      return fail("INVALID_PATH", "A valid path is required.");
    }
    if (!db.canOpenPath(targetPath)) {
      return fail("OPEN_PATH_FORBIDDEN", "The requested path is outside the managed desktop workspace.");
    }
    const error = await shell.openPath(targetPath);
    return error ? fail("OPEN_PATH_FAILED", error) : ok(true);
  });

  registerHandle(IPC_CHANNELS.saveCompany, async (_event, payload) => {
    const parsed = companyInputSchema.parse(payload);
    const id = db.saveCompany(parsed);
    db.addActivity({
      companyId: id,
      actor: "board",
      action: parsed.id ? "company.updated" : "company.created",
      entityType: "company",
      entityId: id,
      detail: parsed.name,
    });
    publishDomainChanged();
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.setCurrentCompany, async (_event, companyId) => {
    let parsedCompanyId: string;
    try {
      parsedCompanyId = companyIdSchema.parse(companyId);
    } catch {
      return fail("INVALID_COMPANY_ID", "A valid company id is required.");
    }
    if (!db.hasCompany(parsedCompanyId)) {
      return fail("COMPANY_NOT_FOUND", "The selected company does not exist.");
    }
    db.setCurrentCompany(parsedCompanyId);
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.saveConnector, async (_event, payload) => {
    const parsed = connectorInputSchema.parse(payload);
    const definition = getConnectorDefinition(parsed.id);
    if (parsed.command !== definition.defaultCommand) {
      return fail("CONNECTOR_COMMAND_LOCKED", `Connector command is managed by AgentCompany and must remain "${definition.defaultCommand}".`);
    }
    db.saveConnector({
      ...parsed,
      command: definition.defaultCommand,
      model: parsed.model ?? null,
    });
    db.addActivity({
      companyId: db.getCurrentCompanyId() ?? randomFallbackCompanyId(),
      actor: "board",
      action: "connector.updated",
      entityType: "connector",
      entityId: parsed.id,
      detail: definition.defaultCommand,
    });
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.testConnector, async (_event, id) => {
    const parsed = connectorInputSchema.shape.id.parse(id);
    await checkConnector(parsed);
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.saveWorkspace, async (_event, payload) => {
    const parsed = workspaceInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const invalidReference = findInvalidReference(parsed.companyId, [
      { id: parsed.projectId, table: "projects", label: "project" },
    ]);
    if (invalidReference) {
      return fail("INVALID_COMPANY_REFERENCE", `The selected ${invalidReference.label} does not belong to the current company.`);
    }
    const id = db.saveWorkspace(parsed);
    db.addActivity({
      companyId: parsed.companyId,
      actor: "board",
      action: parsed.id ? "workspace.updated" : "workspace.created",
      entityType: "workspace",
      entityId: id,
      detail: parsed.localPath,
    });
    publishDomainChanged();
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.saveAgent, async (_event, payload) => {
    const parsed = agentInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const invalidReference = findInvalidReference(parsed.companyId, [
      { id: parsed.reportsTo, table: "agents", label: "manager" },
      { id: parsed.workspaceId, table: "workspaces", label: "workspace" },
    ]);
    if (invalidReference) {
      return fail("INVALID_COMPANY_REFERENCE", `The selected ${invalidReference.label} does not belong to the current company.`);
    }
    let id: string;
    try {
      id = db.saveAgent({
        id: parsed.id ?? null,
        companyId: parsed.companyId,
        name: parsed.name,
        role: parsed.role,
        title: parsed.title,
        status: parsed.status,
        reportsTo: parsed.reportsTo ?? null,
        connectorId: parsed.connectorId,
        workspaceId: parsed.workspaceId ?? null,
        model: parsed.model ?? null,
        metadataJson: parsed.metadataJson,
        capabilities: parsed.capabilities,
        budgetMonthlyUsd: parsed.budgetMonthlyUsd,
      });
    } catch (error) {
      return fail("INVALID_AGENT_HIERARCHY", error instanceof Error ? error.message : "Agent could not be saved.");
    }
    db.addActivity({
      companyId: parsed.companyId,
      actor: "board",
      action: parsed.id ? "agent.updated" : "agent.created",
      entityType: "agent",
      entityId: id,
      detail: parsed.name,
    });
    publishDomainChanged();
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.saveGoal, async (_event, payload) => {
    const parsed = goalInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const invalidReference = findInvalidReference(parsed.companyId, [
      { id: parsed.parentId, table: "goals", label: "parent goal" },
      { id: parsed.ownerAgentId, table: "agents", label: "owner agent" },
    ]);
    if (invalidReference) {
      return fail("INVALID_COMPANY_REFERENCE", `The selected ${invalidReference.label} does not belong to the current company.`);
    }
    const id = db.saveGoal(parsed);
    db.addActivity({
      companyId: parsed.companyId,
      actor: "board",
      action: parsed.id ? "goal.updated" : "goal.created",
      entityType: "goal",
      entityId: id,
      detail: parsed.title,
    });
    publishDomainChanged();

    // Auto-cascade: when a goal becomes active with an owner agent, enable heartbeat and wake immediately
    if (parsed.status === "active" && parsed.ownerAgentId) {
      wakeAgentIfPossible(parsed.ownerAgentId, parsed.companyId, "goal_activated");
    }

    return ok(id);
  });

  registerHandle(IPC_CHANNELS.saveProject, async (_event, payload) => {
    const parsed = projectInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const invalidReference = findInvalidReference(parsed.companyId, [
      { id: parsed.goalId, table: "goals", label: "goal" },
      { id: parsed.leadAgentId, table: "agents", label: "lead agent" },
    ]);
    if (invalidReference) {
      return fail("INVALID_COMPANY_REFERENCE", `The selected ${invalidReference.label} does not belong to the current company.`);
    }
    const id = db.saveProject(parsed);
    db.addActivity({
      companyId: parsed.companyId,
      actor: "board",
      action: parsed.id ? "project.updated" : "project.created",
      entityType: "project",
      entityId: id,
      detail: parsed.name,
    });
    if (parsed.leadAgentId) {
      wakeAgentIfPossible(parsed.leadAgentId, parsed.companyId, "assignment");
    }
    publishDomainChanged();
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.saveTask, async (_event, payload) => {
    const parsed = taskInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const invalidReference = findInvalidReference(parsed.companyId, [
      { id: parsed.projectId, table: "projects", label: "project" },
      { id: parsed.goalId, table: "goals", label: "goal" },
      { id: parsed.parentId, table: "tasks", label: "parent task" },
      { id: parsed.assigneeAgentId, table: "agents", label: "assignee agent" },
      { id: parsed.workspaceId, table: "workspaces", label: "workspace" },
    ]);
    if (invalidReference) {
      return fail("INVALID_COMPANY_REFERENCE", `The selected ${invalidReference.label} does not belong to the current company.`);
    }
    let id: string;
    try {
      id = db.saveTask(parsed);
    } catch (error) {
      return fail("INVALID_TASK_STATE", error instanceof Error ? error.message : "Task could not be saved.");
    }
    db.addActivity({
      companyId: parsed.companyId,
      actor: "board",
      action: parsed.id ? "task.updated" : "task.created",
      entityType: "task",
      entityId: id,
      detail: parsed.title,
    });
    if (parsed.assigneeAgentId) {
      wakeAgentIfPossible(parsed.assigneeAgentId, parsed.companyId, "assignment");
    }
    publishDomainChanged();
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.requestApproval, async (_event, payload) => {
    const parsed = approvalInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const invalidReference = findInvalidReference(parsed.companyId, [
      { id: parsed.relatedTaskId, table: "tasks", label: "task" },
      { id: parsed.requestedByAgentId, table: "agents", label: "requesting agent" },
    ]);
    if (invalidReference) {
      return fail("INVALID_COMPANY_REFERENCE", `The selected ${invalidReference.label} does not belong to the current company.`);
    }
    const id = db.requestApproval(parsed);
    db.addActivity({
      companyId: parsed.companyId,
      actor: parsed.requestedByAgentId ?? "board",
      action: "approval.created",
      entityType: "approval",
      entityId: id,
      detail: parsed.payloadSummary,
    });
    notify("Approval requested", parsed.payloadSummary);
    publishDomainChanged();
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.decideApproval, async (_event, payload) => {
    const parsed = approvalDecisionSchema.parse(payload);
    db.decideApproval(parsed);
    const snapshot = db.listSnapshot();
    const approval = snapshot.approvals.find((entry) => entry.id === parsed.approvalId);
    if (approval) {
      db.addActivity({
        companyId: approval.companyId,
        actor: "board",
        action: `approval.${parsed.state}`,
        entityType: "approval",
        entityId: approval.id,
        detail: parsed.decisionNote,
      });
      if (parsed.state === "approved" || parsed.state === "revision_requested" || parsed.state === "rejected") {
        wakeAgentIfPossible(approval.requestedByAgentId, approval.companyId, "approval_resolved");
      }

      // Step 4: Wake newly hired agent when hire is approved
      if (approval.type === "hire_agent" && parsed.state === "approved") {
        try {
          const fullApproval = db.getApprovalRecord(parsed.approvalId);
          const payload = JSON.parse(fullApproval.payloadJson || "{}") as { agentId?: string };
          if (payload.agentId) {
            // Don't wake new hires if org-strategy is still pending approval
            const hasPendingOrgApproval = snapshot.approvals.some(
              (a) =>
                a.companyId === approval.companyId &&
                a.type === "approve_ceo_strategy" &&
                (a.state === "pending" || a.state === "revision_requested"),
            );
            if (!hasPendingOrgApproval) {
              wakeAgentIfPossible(payload.agentId, approval.companyId, "assignment");
            }
          }
        } catch { /* ignore if approval payload is malformed */ }
      }
    }
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.saveSecret, async (_event, payload) => {
    const parsed = secretInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const id = db.saveSecret(parsed);
    db.addActivity({
      companyId: parsed.companyId,
      actor: "board",
      action: parsed.id ? "secret.updated" : "secret.created",
      entityType: "secret",
      entityId: id,
      detail: parsed.name,
    });
    publishDomainChanged();
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.startTaskRun, async (_event, payload) => {
    if (!worker) return fail("WORKER_UNAVAILABLE", "Orchestration worker is not ready.");
    const parsed = startRunSchema.parse(payload);
    const task = db.getTask(parsed.taskId);
    const snapshot = db.listSnapshot();
    const company = snapshot.companies.find((entry) => entry.id === task.companyId) ?? null;
    if (!company || company.status !== "active") {
      return fail("COMPANY_NOT_ACTIVE", "Runs can only start while the company is active.");
    }
    if (
      task.activeRunId ||
      snapshot.runs.some(
        (run) => run.taskId === task.id && run.companyId === task.companyId && (run.status === "queued" || run.status === "running"),
      )
    ) {
      return fail("TASK_ALREADY_RUNNING", "This task already has an active run.");
    }
    if (!task.assigneeAgentId) return fail("TASK_UNASSIGNED", "Assign an agent before starting a run.");
    const agent = db.getAgent(task.assigneeAgentId);
    if (agent.companyId !== task.companyId) {
      return fail("AGENT_COMPANY_MISMATCH", "The assigned agent does not belong to the task company.");
    }
    const connector = db.getConnector(agent.connectorId);
    const eligibilityFailure = getRunEligibilityFailure(agent, connector);
    if (eligibilityFailure === "AGENT_NOT_RUNNABLE") {
      return fail("AGENT_NOT_RUNNABLE", "The assigned agent is paused, pending approval, or terminated.");
    }
    if (eligibilityFailure === "AGENT_BUDGET_EXHAUSTED") {
      return fail("AGENT_BUDGET_EXHAUSTED", "The assigned agent has exhausted its monthly budget.");
    }
    if (eligibilityFailure === "CONNECTOR_NOT_READY") {
      return fail("CONNECTOR_NOT_READY", "The assigned agent connector is not ready.");
    }
    if (
      snapshot.runs.some(
        (run) => run.companyId === task.companyId && run.agentId === agent.id && (run.status === "queued" || run.status === "running"),
      )
    ) {
      return fail("AGENT_ALREADY_RUNNING", "The assigned agent already has an active run.");
    }

    // Phase 3: Approval hard gate — block runs when relevant approvals are pending
    if (db.isAgentPendingApproval(agent.id)) {
      return fail("AGENT_PENDING_APPROVAL", "This agent is pending hire approval and cannot run tasks.");
    }
    const blockingApproval = db.getBlockingApproval(task.companyId, agent.id, task.id);
    if (blockingApproval) {
      return fail(
        "APPROVAL_GATE_BLOCKED",
        `Run blocked by pending approval: ${blockingApproval.type} — "${blockingApproval.payloadSummary}". Approve or reject before starting.`,
      );
    }

    const workspace =
      db.getWorkspace(task.workspaceId) ??
      db.getWorkspace(agent.workspaceId) ??
      db.getProjectPrimaryWorkspace(task.companyId) ??
      db.getAnyCompanyWorkspace(task.companyId);

    log.info(
      `[run] Workspace resolution for ${agent.name}: task.workspaceId=${task.workspaceId ?? "null"}, agent.workspaceId=${agent.workspaceId ?? "null"}, resolved=${workspace?.name ?? "NONE"}, localPath=${workspace?.localPath ?? "NONE"}`,
    );

    if (workspace && workspace.companyId !== task.companyId) {
      return fail("WORKSPACE_COMPANY_MISMATCH", "The selected workspace does not belong to the task company.");
    }

    // Check workspace lock BEFORE creating the run — fail if another run holds it
    if (workspace && !db.acquireWorkspaceLock(workspace.id, `pre-check-manual-${agent.id}`)) {
      return fail("WORKSPACE_LOCKED", `Workspace "${workspace.name}" is locked by another active run. Wait for it to finish or cancel it.`);
    }
    if (workspace) {
      db.releaseWorkspaceLock(workspace.id, `pre-check-manual-${agent.id}`);
    }

    const run = db.createRun({
      companyId: task.companyId,
      taskId: task.id,
      agentId: agent.id,
      workspaceId: workspace?.id ?? null,
      connectorId: connector.id,
    });

    // Acquire workspace lock with real run ID — if race condition, cancel the run
    if (workspace) {
      const locked = db.acquireWorkspaceLock(workspace.id, run.id);
      if (!locked) {
        db.finishRun({ runId: run.id, status: "cancelled", summary: "Workspace lock contention.", errorMessage: null, exitCode: null, signal: null, model: null, sessionDisplayId: null, costUsd: null, unattributedCost: true });
        return fail("WORKSPACE_LOCKED", `Workspace "${workspace.name}" was locked by another run during startup.`);
      }
    }

    const env = db.resolveSecretEnv(connector.envBindingText, task.companyId);

    // Build rich prompt with API context
    const apiPort = apiServer?.getPort() ?? 0;
    const apiUrl = apiPort ? `http://127.0.0.1:${apiPort}` : "";
    const apiKey = apiUrl ? createAgentToken(agent.id, task.companyId, run.id) : "";

    const systemPrompt = apiUrl ? buildTaskPrompt({
      agent,
      apiUrl,
      apiKey,
      runId: run.id,
      task,
      companyName: snapshot.companies.find((c) => c.id === task.companyId)?.name ?? "Company",
      goals: snapshot.goals.filter((g) => g.companyId === task.companyId),
      projects: snapshot.projects.filter((p) => p.companyId === task.companyId),
      directReports: db.getDirectReports(agent.id, task.companyId),
      chainOfCommand: db.getChainOfCommand(agent.id),
      assignedTasks: db.listAgentTasks(agent.id, task.companyId, ["todo", "in_progress", "blocked"]),
      allAgents: snapshot.agents.filter((a) => a.companyId === task.companyId),
      pendingApprovals: snapshot.approvals.filter(
        (a) => a.companyId === task.companyId &&
          a.requestedByAgentId === agent.id &&
          (a.state === "pending" || a.state === "revision_requested"),
      ),
      tasksAwaitingReview: db.listReviewTasksForManager(agent.id, task.companyId),
      wakeReason: "manual",
    }) : null;

    // Add API credentials to env
    if (apiUrl) {
      env.AGENT_COMPANY_API_URL = apiUrl;
      env.AGENT_COMPANY_API_KEY = apiKey;
      env.AGENT_COMPANY_AGENT_ID = agent.id;
      env.AGENT_COMPANY_COMPANY_ID = task.companyId;
      env.AGENT_COMPANY_RUN_ID = run.id;
      env.AGENT_COMPANY_TASK_ID = task.id;
      env.AGENT_COMPANY_WAKE_REASON = "manual";
    }

    const session = db.getTaskSession(task.id);
    let thinkingEffort: string | null = null;
    try {
      const meta = JSON.parse(agent.metadataJson || "{}");
      if (typeof meta.thinkingEffort === "string" && meta.thinkingEffort) {
        thinkingEffort = meta.thinkingEffort;
      }
    } catch { /* ignore malformed json */ }
    worker.postMessage({
      type: "enqueue-run",
      payload: {
        runId: run.id,
        companyId: task.companyId,
        taskId: task.id,
        taskTitle: task.title,
        taskDescription: task.description,
        agentId: agent.id,
        agentName: agent.name,
        connectorId: connector.id,
        workspaceId: workspace?.id ?? null,
        workspacePath: workspace?.localPath ?? null,
        command: connector.command,
        model: connector.model ?? agent.model,
        thinkingEffort,
        env,
        sessionParams: session.sessionParams,
        systemPrompt,
        trigger: "manual",
      },
    });
    db.addActivity({
      companyId: task.companyId,
      actor: "board",
      action: "run.queued",
      entityType: "run",
      entityId: run.id,
      detail: task.title,
    });
    publishDomainChanged();
    return ok(run.id);
  });

  registerHandle(IPC_CHANNELS.cancelRun, async (_event, payload) => {
    const parsed = cancelRunSchema.parse(payload);
    worker?.postMessage({ type: "cancel-run", runId: parsed.runId });
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.getRunLog, async (_event, payload) => {
    const parsed = runLogSchema.parse(payload);
    return ok(db.readRunLog(parsed.runId));
  });

  registerHandle(IPC_CHANNELS.backupProfile, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return ok(null);
    const backupPath = join(result.filePaths[0]!, `agentcompany-backup-${Date.now()}`);
    await db.exportBackup(backupPath);
    return ok(backupPath);
  });

  registerHandle(IPC_CHANNELS.restoreProfile, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return ok(false);
    await db.restoreFromBackup(result.filePaths[0]!);
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.updateSettings, async (_event, payload) => {
    const parsed = settingsSchema.parse(payload);
    db.updateSettings(parsed);
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.checkForUpdates, async () => {
    await checkForUpdates();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.deleteCompany, async (_event, companyId) => {
    if (typeof companyId !== "string" || companyId.length === 0) {
      return fail("INVALID_INPUT", "Company ID is required.");
    }
    if (!db.hasCompany(companyId)) {
      return fail("COMPANY_NOT_FOUND", "Company not found.");
    }
    db.deleteCompany(companyId);
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.deleteAgent, async (_event, payload) => {
    const parsed = deleteEntitySchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.belongsToCompany("agents", parsed.id, parsed.companyId)) {
      return fail("AGENT_NOT_FOUND", "Agent not found in the current company.");
    }
    db.deleteAgent(parsed.id, parsed.companyId);
    db.addActivity({ companyId: parsed.companyId, actor: "board", action: "agent.deleted", entityType: "agent", entityId: parsed.id, detail: "" });
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.deleteTask, async (_event, payload) => {
    const parsed = deleteEntitySchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.belongsToCompany("tasks", parsed.id, parsed.companyId)) {
      return fail("TASK_NOT_FOUND", "Task not found in the current company.");
    }
    db.deleteTask(parsed.id, parsed.companyId);
    db.addActivity({ companyId: parsed.companyId, actor: "board", action: "task.deleted", entityType: "task", entityId: parsed.id, detail: "" });
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.deleteGoal, async (_event, payload) => {
    const parsed = deleteEntitySchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.belongsToCompany("goals", parsed.id, parsed.companyId)) {
      return fail("GOAL_NOT_FOUND", "Goal not found in the current company.");
    }
    db.deleteGoal(parsed.id, parsed.companyId);
    db.addActivity({ companyId: parsed.companyId, actor: "board", action: "goal.deleted", entityType: "goal", entityId: parsed.id, detail: "" });
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.deleteProject, async (_event, payload) => {
    const parsed = deleteEntitySchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.belongsToCompany("projects", parsed.id, parsed.companyId)) {
      return fail("PROJECT_NOT_FOUND", "Project not found in the current company.");
    }
    db.deleteProject(parsed.id, parsed.companyId);
    db.addActivity({ companyId: parsed.companyId, actor: "board", action: "project.deleted", entityType: "project", entityId: parsed.id, detail: "" });
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.deleteWorkspace, async (_event, payload) => {
    const parsed = deleteEntitySchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.belongsToCompany("workspaces", parsed.id, parsed.companyId)) {
      return fail("WORKSPACE_NOT_FOUND", "Workspace not found in the current company.");
    }
    db.deleteWorkspace(parsed.id, parsed.companyId);
    db.addActivity({ companyId: parsed.companyId, actor: "board", action: "workspace.deleted", entityType: "workspace", entityId: parsed.id, detail: "" });
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.deleteApproval, async (_event, payload) => {
    const parsed = deleteEntitySchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.belongsToCompany("approvals", parsed.id, parsed.companyId)) {
      return fail("APPROVAL_NOT_FOUND", "Approval not found in the current company.");
    }
    db.deleteApproval(parsed.id, parsed.companyId);
    db.addActivity({ companyId: parsed.companyId, actor: "board", action: "approval.deleted", entityType: "approval", entityId: parsed.id, detail: "" });
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.deleteSecret, async (_event, payload) => {
    const parsed = deleteEntitySchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.belongsToCompany("secrets", parsed.id, parsed.companyId)) {
      return fail("SECRET_NOT_FOUND", "Secret not found in the current company.");
    }
    db.deleteSecret(parsed.id, parsed.companyId);
    db.addActivity({ companyId: parsed.companyId, actor: "board", action: "secret.deleted", entityType: "secret", entityId: parsed.id, detail: "" });
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.getSidebarBadges, async (_event, companyId) => {
    let parsedCompanyId: string;
    try {
      parsedCompanyId = companyIdSchema.parse(companyId);
    } catch {
      return fail("INVALID_COMPANY_ID", "A valid company id is required.");
    }
    return ok(db.getSidebarBadges(parsedCompanyId));
  });

  /* ─── Comments ────────────────────────────────────────────────────── */

  registerHandle(IPC_CHANNELS.addComment, async (_event, payload) => {
    const parsed = commentInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const comment = db.addComment({
      companyId: parsed.companyId,
      taskId: parsed.taskId,
      authorAgentId: parsed.authorAgentId ?? null,
      authorName: parsed.authorName,
      body: parsed.body,
    });
    db.addActivity({
      companyId: parsed.companyId,
      actor: parsed.authorAgentId ?? "board",
      action: "comment.created",
      entityType: "task",
      entityId: parsed.taskId,
      detail: parsed.body.slice(0, 100),
    });
    emitEvent({ type: "agent-message", taskId: parsed.taskId, comment });
    publishDomainChanged();

    // Step 5c: Wake task assignee when Board/UI posts a comment
    try {
      const task = db.getTask(parsed.taskId);
      if (task.assigneeAgentId) {
        wakeAgentIfPossible(task.assigneeAgentId, task.companyId, "comment");
      }
    } catch { /* ignore if task not found */ }

    return ok(comment.id);
  });

  registerHandle(IPC_CHANNELS.listComments, async (_event, payload) => {
    const parsed = listCommentsSchema.parse(payload);
    return ok(db.listComments(parsed.taskId));
  });

  /* ─── Heartbeat ──────────────────────────────────────────────────── */

  registerHandle(IPC_CHANNELS.setHeartbeat, async (_event, payload) => {
    const parsed = heartbeatSettingsSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.belongsToCompany("agents", parsed.agentId, parsed.companyId)) {
      return fail("AGENT_NOT_FOUND", "Agent not found in the current company.");
    }
    db.setHeartbeat(parsed.agentId, parsed.enabled, parsed.intervalSec);
    db.addActivity({
      companyId: parsed.companyId,
      actor: "board",
      action: parsed.enabled ? "heartbeat.enabled" : "heartbeat.disabled",
      entityType: "agent",
      entityId: parsed.agentId,
      detail: `Interval: ${parsed.intervalSec}s`,
    });
    emitEvent({ type: "heartbeat-status", agentId: parsed.agentId, enabled: parsed.enabled, nextWakeAt: null });
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.triggerHeartbeat, async (_event, payload) => {
    const parsed = triggerHeartbeatSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.belongsToCompany("agents", parsed.agentId, parsed.companyId)) {
      return fail("AGENT_NOT_FOUND", "Agent not found in the current company.");
    }
    const runId = startAgentHeartbeatRun(parsed.agentId, parsed.companyId, parsed.trigger);
    if (!runId) return fail("HEARTBEAT_SKIPPED", "Agent cannot be woken right now (check connector status, budget, or active runs).");
    return ok(runId);
  });

  registerHandle(IPC_CHANNELS.getApiPort, async () => {
    return ok(apiServer?.getPort() ?? 0);
  });

  registerHandle(IPC_CHANNELS.listConnectorModels, async (_event, connectorId) => {
    try {
      const parsed = connectorInputSchema.shape.id.parse(connectorId);
      const definition = getConnectorDefinition(parsed);
      if (definition.listModels) {
        const models = await definition.listModels();
        return ok(models);
      }
      return ok([]);
    } catch {
      return ok([]);
    }
  });
}

async function checkForUpdates() {
  const snapshot = db.listSnapshot();
  if (!snapshot.updatesEnabled || process.env.AGENTCOMPANY_DISABLE_UPDATES === "true") {
    return false;
  }
  try {
    autoUpdater.logger = log;
    autoUpdater.autoDownload = false;
    await autoUpdater.checkForUpdates();
    return true;
  } catch (error) {
    log.error(error);
    return false;
  }
}

async function bootstrap() {
  await app.whenReady();
  log.initialize();

  // Resolve the user's full shell PATH for packaged apps.
  // The static PATH fix above covers common directories, but the login shell
  // may have additional paths from .zshrc, .bashrc, nvm, pyenv, etc.
  if (process.platform !== "win32") {
    try {
      const userShell = process.env.SHELL || "/bin/zsh";
      const shellPath = await new Promise<string>((resolve) => {
        const child = spawn(userShell, ["-ilc", "echo -n $PATH"], {
          env: { ...process.env },
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 5000,
        });
        let output = "";
        child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
        child.on("close", () => resolve(output.trim()));
        child.on("error", () => resolve(""));
      });
      if (shellPath && shellPath.length > 0) {
        const current = new Set((process.env.PATH ?? "").split(":").filter(Boolean));
        const shellParts = shellPath.split(":").filter(Boolean);
        const toAdd = shellParts.filter((p) => !current.has(p));
        if (toAdd.length > 0) {
          process.env.PATH = [process.env.PATH, ...toAdd].join(":");
          log.info(`[path] Added ${toAdd.length} shell PATH entries.`);
        }
      }
    } catch {
      // Non-fatal — static PATH fix is already in place
    }
  }

  // Set app icon for dock/taskbar (applies even during dev)
  const appIcon = nativeImage.createFromPath(ICON_PATH);
  if (!appIcon.isEmpty()) {
    if (process.platform === "darwin" && app.dock) {
      app.dock.setIcon(appIcon);
    }
  }

  if (process.platform === "win32") {
    app.setAppUserModelId("com.agentcompany.desktop");
  }
  installSecurityGuards();
  registerProtocol();
  db = new AppDatabase(process.env.AGENTCOMPANY_PROFILE_DIR ?? join(app.getPath("userData"), "profile"));
  db.init();
  buildMenu();
  createWorker();
  registerHandlers();

  // Start local API server for agent-to-system interaction
  apiServer = new AgentApiServer(db, publishDomainChanged, (agentId, companyId, trigger) => {
    wakeAgentIfPossible(agentId, companyId, trigger);
  });
  await apiServer.start();

  // Start heartbeat scheduler for continuous agent operation
  startHeartbeatScheduler();

  await createWindow();

  for (const connector of db.listSnapshot().connectors) {
    void checkConnector(connector.id);
  }

  app.on("activate", async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      mainWindow.focus();
      return;
    }
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
}

const hasSingleInstanceLock =
  process.env.AGENTCOMPANY_DISABLE_SINGLE_INSTANCE === "true"
    ? true
    : app.requestSingleInstanceLock();

app.on("second-instance", () => {
  if (!hasSingleInstanceLock) {
    return;
  }
  if (!mainWindow) {
    return;
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
});

app.on("window-all-closed", () => {
  // Keep the process alive so scheduled automation and background runs continue.
});

app.on("before-quit", () => {
  isQuitting = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  apiServer?.stop();
  apiServer = null;
  worker?.kill();
  worker = null;
  db?.close();
});

if (hasSingleInstanceLock) {
  void bootstrap();
} else {
  app.quit();
}
