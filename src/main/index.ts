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
  Tray,
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
  browserActionQuerySchema,
  cancelRunSchema,
  commentInputSchema,
  companyInputSchema,
  connectorInputSchema,
  deleteEntitySchema,
  goalInputSchema,
  heartbeatSettingsSchema,
  listCommentsSchema,
  metricsQuerySchema,
  type DesktopResult,
  projectInputSchema,
  runLogSchema,
  secretInputSchema,
  settingsSchema,
  socialAccountInputSchema,
  startRunSchema,
  taskInputSchema,
  templateApplySchema,
  triggerHeartbeatSchema,
  workspaceInputSchema,
  meetingInputSchema,
  documentInputSchema,
  knowledgeEntryInputSchema,
  sprintInputSchema,
  automationRuleInputSchema,
  agentMessageInputSchema,
  messageQuerySchema,
  workflowInputSchema,
  autoAssignSchema,
  toggleAutomationRuleSchema,
  markMessageReadSchema,
  runWorkflowSchema,
} from "@shared/contracts";
import type { DesktopEvent, RunRecord } from "@shared/types";
import { getConnectorDefinition } from "./connectors";
import { AppDatabase } from "./database";
import { AgentApiServer } from "./api-server";
import { createAgentToken } from "./agent-auth";
import { buildTaskPrompt } from "./prompt-builder";
import { COMPANY_TEMPLATES, getTemplate } from "./templates";
import { BrowserManager } from "./browser-manager";

app.name = "AgentCompany";

// Packaged Electron apps inherit a minimal PATH; prepend common tool directories
// so CLI connectors (claude, codex, gemini, etc.) can be found.
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
let browserManager: BrowserManager | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let appTray: Tray | null = null;
const scheduleLastFiredMap = new Map<string, number>();
const activeAutomationExecutions = new Set<string>();
const activeWorkflowTriggerExecutions = new Set<string>();
// Budget reset tracking moved to database (db.getLastBudgetResetMonth / db.setLastBudgetResetMonth)
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
type WorkspaceLockMode = "exclusive" | "shared" | "none";

interface WorkspaceResolution {
  workspace: ReturnType<typeof db.getWorkspace>;
  lockMode: WorkspaceLockMode;
  source: "task" | "agent" | "project" | "company_fallback" | "none";
}

function ok<T>(data: T): DesktopResult<T> {
  return { ok: true, data };
}

function fail(code: string, message: string): DesktopResult<never> {
  return { ok: false, error: { code, message } };
}

function hasActiveRun(_snapshot: ReturnType<typeof db.listSnapshot>, filter: { taskId?: string; agentId?: string; companyId: string }) {
  return db.hasActiveRun(filter);
}

function resolveWorkspace(
  task: { workspaceId: string | null; projectId?: string | null },
  agent: { workspaceId: string | null },
  companyId: string,
): WorkspaceResolution {
  const taskWorkspace = db.getWorkspace(task.workspaceId);
  if (taskWorkspace) {
    return { workspace: taskWorkspace, lockMode: "exclusive", source: "task" };
  }

  const agentWorkspace = db.getWorkspace(agent.workspaceId);
  if (agentWorkspace) {
    return { workspace: agentWorkspace, lockMode: "exclusive", source: "agent" };
  }

  const projectWorkspace = db.getProjectPrimaryWorkspace(task.projectId ?? null, companyId);
  if (projectWorkspace) {
    return { workspace: projectWorkspace, lockMode: "exclusive", source: "project" };
  }

  const fallbackWorkspace = db.getAnyCompanyWorkspace(companyId);
  if (fallbackWorkspace) {
    return { workspace: fallbackWorkspace, lockMode: "shared", source: "company_fallback" };
  }

  return { workspace: null, lockMode: "none", source: "none" };
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

function normalizeWorkflowSteps(raw: unknown) {
  if (!Array.isArray(raw)) {
    throw new Error("Workflow steps must be a JSON array.");
  }
  return raw.map((entry, index) => {
    const step = (entry ?? {}) as Record<string, unknown>;
    const action = typeof step.action === "string" ? step.action : "send_message";
    return {
      id: typeof step.id === "string" && step.id ? step.id : `step-${index + 1}`,
      name: typeof step.name === "string" && step.name ? step.name : `Step ${index + 1}`,
      action,
      configJson: typeof step.configJson === "string" ? step.configJson : "{}",
      assigneeDepartment: typeof step.assigneeDepartment === "string" ? step.assigneeDepartment : null,
      assigneeAgentId: typeof step.assigneeAgentId === "string" ? step.assigneeAgentId : null,
      requiresApproval: step.requiresApproval === true,
      timeoutSec: typeof step.timeoutSec === "number" ? step.timeoutSec : 0,
      status: ["pending", "running", "completed", "failed", "skipped"].includes(String(step.status)) ? String(step.status) : "pending",
    };
  });
}

function resolveWorkflowStepActor(step: ReturnType<typeof normalizeWorkflowSteps>[number], companyId: string) {
  if (step.assigneeAgentId) {
    const agent = db.getAgent(step.assigneeAgentId);
    if (agent.companyId !== companyId) {
      throw new Error(`Workflow step assignee ${step.assigneeAgentId} does not belong to company ${companyId}.`);
    }
    return agent;
  }

  if (step.assigneeDepartment) {
    const idleAgents = db.getIdleAgentsForDepartment(companyId, step.assigneeDepartment);
    if (idleAgents.length > 0) {
      return db.getAgent(idleAgents[0]!.id);
    }
  }

  const snapshot = db.listSnapshot();
  return snapshot.agents.find((agent) => agent.companyId === companyId && !agent.reportsTo && agent.status !== "terminated") ?? null;
}

function buildWorkflowActionContext(
  companyId: string,
  step: ReturnType<typeof normalizeWorkflowSteps>[number],
  actor: ReturnType<typeof resolveWorkflowStepActor>,
) {
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(step.configJson) as Record<string, unknown>;
  } catch {
    throw new Error(`Workflow step "${step.name}" has invalid config JSON.`);
  }

  return {
    config,
    ctx: {
      companyId,
      agentId: actor?.id,
      department: actor?.department ?? step.assigneeDepartment ?? undefined,
      taskId: typeof config.taskId === "string" ? config.taskId : undefined,
      runId: typeof config.runId === "string" ? config.runId : undefined,
      projectId: typeof config.projectId === "string" ? config.projectId : undefined,
      newStatus: typeof config.status === "string" ? config.status : undefined,
    },
  };
}

async function runWorkflowPipeline(workflowId: string, companyId: string) {
  const workflow = db.getWorkflowRecord(workflowId, companyId);
  if (!workflow) {
    throw new Error("Workflow not found.");
  }
  const previousWorkflowStatus = workflow.status;
  const parsedSteps = normalizeWorkflowSteps(JSON.parse(workflow.stepsJson || "[]"));
  const hasRunningStep = parsedSteps.some((step) => step.status === "running");
  if (hasRunningStep) {
    throw new Error("Workflow is already running.");
  }
  if (parsedSteps.length === 0) {
    throw new Error("Workflow has no steps.");
  }

  const resumeFrom = workflow.status === "paused" ? workflow.currentStepIndex : 0;
  const steps = parsedSteps.map((step, index) => {
    if (workflow.status !== "paused") {
      return { ...step, status: index < resumeFrom ? "completed" : "pending" };
    }
    return step;
  });

  db.updateWorkflowExecution({
    id: workflowId,
    companyId,
    status: "active",
    currentStepIndex: resumeFrom,
    stepsJson: JSON.stringify(steps),
    incrementRunCount: true,
    lastRunAt: new Date().toISOString(),
  });
  publishDomainChanged();

  for (let index = resumeFrom; index < steps.length; index += 1) {
    const step = steps[index]!;
    step.status = "running";
    db.updateWorkflowExecution({
      id: workflowId,
      companyId,
      status: "active",
      currentStepIndex: index,
      stepsJson: JSON.stringify(steps),
      lastRunAt: new Date().toISOString(),
    });
    publishDomainChanged();

    const actor = resolveWorkflowStepActor(step, companyId);
    const { config, ctx } = buildWorkflowActionContext(companyId, step, actor);

    if (step.requiresApproval) {
      const approvalId = db.requestApproval({
        companyId,
        requestedByAgentId: actor?.id ?? null,
        relatedTaskId: ctx.taskId ?? null,
        type: "dangerous_command",
        payloadSummary: `Workflow approval required: ${workflow.name} / ${step.name}`,
        impactSummary: `Workflow step "${step.name}" requires board approval before ${step.action}.`,
        payloadJson: JSON.stringify({ workflowId, stepId: step.id, stepName: step.name }),
      });
      step.status = "pending";
      db.updateWorkflowExecution({
        id: workflowId,
        companyId,
        status: "paused",
        currentStepIndex: index,
        stepsJson: JSON.stringify(steps),
        lastRunAt: new Date().toISOString(),
      });
      db.addActivity({
        companyId,
        actor: actor?.id ?? "system",
        action: "workflow.paused_for_approval",
        entityType: "workflow",
        entityId: workflowId,
        detail: `Paused on step "${step.name}" with approval ${approvalId}.`,
      });
      publishDomainChanged();
      return;
    }

    try {
      executeAutomationAction(
        {
          action: step.action,
          actionConfigJson: JSON.stringify(config),
          targetDepartment: step.assigneeDepartment,
          trigger: "workflow_step",
        },
        ctx,
      );
      step.status = "completed";
      db.addActivity({
        companyId,
        actor: actor?.id ?? "system",
        action: "workflow.step_completed",
        entityType: "workflow",
        entityId: workflowId,
        detail: step.name,
      });
      const completionStatus = index === steps.length - 1
        ? (previousWorkflowStatus === "draft" ? "draft" : "active")
        : "active";
      db.updateWorkflowExecution({
        id: workflowId,
        companyId,
        status: completionStatus,
        currentStepIndex: index + 1,
        stepsJson: JSON.stringify(steps),
        lastRunAt: new Date().toISOString(),
      });
      publishDomainChanged();
    } catch (error) {
      step.status = "failed";
      db.updateWorkflowExecution({
        id: workflowId,
        companyId,
        status: "failed",
        currentStepIndex: index,
        stepsJson: JSON.stringify(steps),
        lastRunAt: new Date().toISOString(),
      });
      db.addActivity({
        companyId,
        actor: actor?.id ?? "system",
        action: "workflow.step_failed",
        entityType: "workflow",
        entityId: workflowId,
        detail: `${step.name}: ${error instanceof Error ? error.message : String(error)}`,
      });
      publishDomainChanged();
      throw error;
    }
  }
}

async function dispatchBrowserAction(actionId: string, companyId: string) {
  if (!browserManager) {
    throw new Error("Browser manager not initialized");
  }

  const action = db.getBrowserAction(actionId, companyId);
  if (!action) {
    throw new Error(`Browser action not found: ${actionId}`);
  }

  const account = db.getSocialAccount(action.socialAccountId, companyId);
  if (!account) {
    db.updateBrowserAction(actionId, {
      status: "failed",
      errorMessage: "Social account no longer exists.",
      finishedAt: new Date().toISOString(),
    });
    publishDomainChanged();
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(action.payloadJson) as Record<string, unknown>;
  } catch {
    db.updateBrowserAction(actionId, {
      status: "failed",
      errorMessage: "Browser action payload is not valid JSON.",
      finishedAt: new Date().toISOString(),
    });
    publishDomainChanged();
    return;
  }

  db.updateBrowserAction(actionId, {
    status: "running",
    startedAt: new Date().toISOString(),
    errorMessage: null,
  });
  publishDomainChanged();

  try {
    const result = await browserManager.executeAction({
      id: actionId,
      socialAccountId: account.id,
      platform: account.platform,
      actionType: action.actionType,
      payload,
    });

    db.updateBrowserAction(actionId, {
      status: result.success ? "succeeded" : "failed",
      resultSummary: result.summary,
      screenshotPath: result.screenshotPath,
      errorMessage: result.error,
      finishedAt: new Date().toISOString(),
    });
  } catch (error) {
    db.updateBrowserAction(actionId, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      finishedAt: new Date().toISOString(),
    });
  }

  publishDomainChanged();
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

function createTray() {
  if (process.platform === "darwin" || appTray) {
    return;
  }

  const trayIcon = nativeImage.createFromPath(ICON_PATH);
  appTray = new Tray(trayIcon.isEmpty() ? nativeImage.createEmpty() : trayIcon);
  appTray.setToolTip("AgentCompany");
  appTray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Show AgentCompany",
        click: () => {
          if (!mainWindow || mainWindow.isDestroyed()) {
            void createWindow();
            return;
          }
          mainWindow.show();
          mainWindow.focus();
        },
      },
      {
        label: "Hide AgentCompany",
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.hide();
          }
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  appTray.on("click", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      void createWindow();
      return;
    }
    if (mainWindow.isVisible()) {
      mainWindow.hide();
      return;
    }
    mainWindow.show();
    mainWindow.focus();
  });
}

function isSocialBrowserSession(contents: Electron.WebContents): boolean {
  return contents.session !== session.defaultSession;
}

function installSecurityGuards() {
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(() => {
      if (isSocialBrowserSession(contents)) {
        return { action: "allow" };
      }
      return { action: "deny" };
    });
    contents.on("will-attach-webview", (event) => {
      event.preventDefault();
    });
    contents.on("will-navigate", (event) => {
      if (isSocialBrowserSession(contents)) return;
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

  worker.on("exit", (code) => {
    if (isQuitting) return;

    log.warn(`[worker] Worker exited with code ${code}, recovering...`);

    const snapshot = db.listSnapshot();
    const affectedAgentIds = new Set<string>();
    const requeueCandidates: Array<{ id: string; taskId: string; agentId: string; companyId: string; workspaceId: string | null; connectorId: string }> = [];

    for (const run of snapshot.runs) {
      if (run.status === "running") {
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

    for (const agentId of affectedAgentIds) {
      const pendingWakes = db.consumePendingWakes(agentId);
      for (const wake of pendingWakes) {
        wakeAgentIfPossible(agentId, wake.companyId, wake.trigger);
      }
    }

    publishDomainChanged();

    createWorker();

    if (requeueCandidates.length > 0 && worker) {
      log.info(`[worker] Re-enqueuing ${requeueCandidates.length} queued run(s) after worker restart.`);
      const recoverySnapshot = db.listSnapshot();
      for (const candidate of requeueCandidates) {
        try {
          const task = db.getTask(candidate.taskId);
          const agent = db.getAgent(candidate.agentId);
          const connector = db.getConnector(agent.connectorId);
          const workspaceResolution = resolveWorkspace(task, agent, candidate.companyId);
          const recoveryCompany = recoverySnapshot.companies.find((c) => c.id === candidate.companyId);

          dispatchRunToWorker({
            runId: candidate.id,
            companyId: candidate.companyId,
            agent,
            task,
            connector,
            workspace: workspaceResolution.workspace,
            workspaceMode: workspaceResolution.lockMode,
            companyName: recoveryCompany?.name ?? "Company",
            companyDescription: recoveryCompany?.description ?? "",
            snapshot: recoverySnapshot,
            trigger: "recovery",
          });
        } catch (error) {
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
      if (event.status === "running") {
        const run = db.listSnapshot().runs.find((entry) => entry.id === event.runId);
        if (run?.workspaceId && !db.claimWorkspaceLock(run.workspaceId, run.id)) {
          log.error(`[workspace] Failed to claim lock for workspace ${run.workspaceId} when run ${run.id} entered running state. Cancelling run.`);
          worker?.postMessage({ type: "cancel-run", runId: run.id });
        }
      }
      emitEvent(event);
      publishDomainChanged();
      return;
    }

    const snapshot = db.listSnapshot();
    const run = snapshot.runs.find((entry) => entry.id === event.runId);
    if (run) {
      const connector = getConnectorDefinition(run.connectorId);

      let task: ReturnType<typeof db.getTask> | null = null;
      try { task = db.getTask(run.taskId); } catch { /* deleted mid-run */ }

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

      let updatedAgent: ReturnType<typeof db.getAgent> | null = null;
      try { updatedAgent = db.getAgent(run.agentId); } catch { /* deleted mid-run */ }

      if (updatedAgent && runOutcome.budgetHardStopped) {
        autoPauseBudgetExceededAgent(updatedAgent);
      }

      if (event.status === "failed" || event.status === "timed_out") {
        try {
          const chain = db.getChainOfCommand(run.agentId);
          if (chain.length > 0) {
            wakeAgentIfPossible(chain[0].id, run.companyId, "report_failed");
          }
        } catch { /* agent deleted, skip escalation */ }
      }

      const pendingWakes = db.consumePendingWakes(run.agentId);
      if (pendingWakes.length > 0) {
        for (const wake of pendingWakes) {
          wakeAgentIfPossible(run.agentId, wake.companyId, wake.trigger);
        }
      }

      processRunCompletion(run, event as z.infer<typeof workerMessageSchema> & { type: "run-finished" });
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
      dangerouslyBypassApprovalsAndSandbox: true,
      dangerouslySkipPermissions: true,
      approvalMode: "yolo",
      sandbox: false,
      yolo: true,
      extraArgs: id === "codex_local" ? ["--skip-git-repo-check"] : [],
    },
  });

  let authState: "ok" | "required" | "error" = "ok";
  if (result.status === "fail") {
    const hasAuthCheck = result.checks.some((check) => check.code.includes("auth") || check.code.includes("login"));
    authState = hasAuthCheck ? "required" : "error";
  }
  const version = await parseVersion(connector.command);

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
    const agent = db.getAgent(agentId);
    if (agent.companyId !== companyId) {
      log.warn(`[wake] Refusing cross-company wake for agent ${agentId}: ${agent.companyId} !== ${companyId}`);
      return null;
    }
  } catch {
    return null;
  }
  try {
    ensureAgentHeartbeatEnabled(agentId);
  } catch {
    return null;
  }

  const snapshot = db.listSnapshot();
  const agentBusy = hasActiveRun(snapshot, { agentId, companyId });

  const runId = startAgentHeartbeatRun(agentId, companyId, trigger);
  if (!runId && agentBusy) {
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
  if (agent.companyId !== companyId) {
    log.warn(`[heartbeat] Refusing cross-company run for agent ${agentId}: ${agent.companyId} !== ${companyId}`);
    return null;
  }
  const connector = db.getConnector(agent.connectorId);
  if (getRunEligibilityFailure(agent, connector)) {
    return null;
  }
  if (hasActiveRun(snapshot, { agentId: agent.id, companyId })) {
    log.info(`[heartbeat] Skipping ${agent.name} because it already has an active run.`);
    return null;
  }

  if (db.isAgentPendingApproval(agentId)) {
    log.info(`[heartbeat] Skipping ${agent.name} because agent is pending hire approval.`);
    return null;
  }

  const assignedTasks = db.listAgentTasks(agentId, companyId, ["todo", "in_progress", "blocked"]);

  const isTimer = trigger === "timer";
  const candidateTasks = isTimer
    ? assignedTasks.filter((entry) => !entry.title.startsWith("[Heartbeat]"))
    : assignedTasks;

  let task = candidateTasks.find((entry) => !entry.activeRunId) ?? null;

  if (!task) {
    const hasActiveAssignedRun = candidateTasks.some(
      (entry) => entry.activeRunId && hasActiveRun(snapshot, { taskId: entry.id, companyId }),
    );
    if (hasActiveAssignedRun) {
      return null;
    }

    // Even on timer triggers, the CEO/executives should wake up to create work
    // when there are active goals. This is the bootstrap mechanism — goals exist
    // but nobody has broken them into tasks yet.
    const isCeo = !agent.reportsTo;
    const isManager = snapshot.agents.some((a) => a.reportsTo === agent.id && a.companyId === companyId);
    const activeGoals = snapshot.goals.filter((g) => g.companyId === companyId && (g.status === "active" || g.status === "planned"));
    const companyTasks = snapshot.tasks.filter((t) => t.companyId === companyId && t.status !== "done" && t.status !== "cancelled");
    const hasUnassignedGoals = activeGoals.length > 0;
    const companyNeedsBootstrap = hasUnassignedGoals && companyTasks.length < activeGoals.length;

    if (isTimer && !isCeo && !isManager && !companyNeedsBootstrap) {
      log.info(`[heartbeat] Skipping ${agent.name} — no actionable tasks and trigger is timer.`);
      return null;
    }

    // Create a work-check task. For CEO/managers this drives planning.
    // For ICs this only happens when the company is bootstrapping.
    const taskTitle = isCeo
      ? `[Heartbeat] ${agent.name} — Strategic planning & task delegation`
      : isManager
        ? `[Heartbeat] ${agent.name} — Review team & delegate work`
        : `[Heartbeat] ${agent.name} — Check for work`;
    const taskDesc = isCeo
      ? `Review active company goals. Break each goal into projects and actionable tasks. Assign tasks to department leads and team members. Create tasks using the API. This is your primary responsibility as CEO — ensure every goal has a clear execution plan with assigned owners.`
      : isManager
        ? `Review your department's goals and your team's workload. Create tasks for your direct reports if they have capacity. Review any work submitted for your approval. Ensure your team is productive and unblocked.`
        : `Automated heartbeat run for ${agent.name}. Review assigned tasks, check goals, and take action as needed.`;

    const taskId = db.saveTask({
      companyId,
      title: taskTitle,
      description: taskDesc,
      assigneeAgentId: agentId,
      workspaceId: agent.workspaceId ?? undefined,
      status: "in_progress",
      priority: isCeo ? "high" : "medium",
    });
    task = db.getTask(taskId);
    log.info(`[heartbeat] Created bootstrap task for ${agent.name}: ${taskTitle}`);
  }
  if (task.activeRunId || hasActiveRun(snapshot, { taskId: task.id, companyId })) {
    log.info(`[heartbeat] Skipping ${agent.name} because task ${task.title} already has an active run.`);
    return null;
  }

  const workspaceResolution = resolveWorkspace(task, agent, companyId);
  const workspace = workspaceResolution.workspace;

  log.info(
    `[heartbeat] Workspace resolution for ${agent.name}: task.workspaceId=${task.workspaceId ?? "null"}, agent.workspaceId=${agent.workspaceId ?? "null"}, projectId=${task.projectId ?? "null"}, source=${workspaceResolution.source}, mode=${workspaceResolution.lockMode}, resolved=${workspace?.name ?? "NONE"}, localPath=${workspace?.localPath ?? "NONE"}`,
  );

  const run = db.createRun({
    companyId,
    taskId: task.id,
    agentId: agent.id,
    workspaceId: workspaceResolution.lockMode === "exclusive" ? (workspace?.id ?? null) : null,
    connectorId: connector.id,
  });

  dispatchRunToWorker({
    runId: run.id,
    companyId,
    agent,
    task,
    connector,
    workspace,
    workspaceMode: workspaceResolution.lockMode,
    companyName: company.name,
    companyDescription: company.description ?? "",
    snapshot,
    trigger,
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

// ── Automation Engine ──────────────────────────────────────────────────

interface AutomationEventContext {
  companyId: string;
  taskId?: string;
  agentId?: string;
  runId?: string;
  projectId?: string;
  department?: string;
  previousStatus?: string;
  newStatus?: string;
  costUsd?: number;
}

function evaluateAutomationRules(trigger: string, ctx: AutomationEventContext) {
  try {
    const rules = db.listActiveAutomationRules(ctx.companyId, trigger);
    for (const rule of rules) {
      if (!matchesConditions(rule, ctx)) continue;
      const executionKey = [
        rule.id,
        trigger,
        ctx.companyId,
        ctx.taskId ?? "-",
        ctx.agentId ?? "-",
        ctx.runId ?? "-",
        ctx.previousStatus ?? "-",
        ctx.newStatus ?? "-",
      ].join(":");
      if (activeAutomationExecutions.has(executionKey)) {
        log.warn(`[automation] Skipping re-entrant execution for rule "${rule.name}" (${executionKey})`);
        continue;
      }
      activeAutomationExecutions.add(executionKey);
      try {
        executeAutomationAction(rule, ctx);
        db.recordAutomationExecution(
          rule.id, ctx.companyId, rule.name, trigger, rule.action,
          `Fired for ${trigger} in context: taskId=${ctx.taskId ?? "n/a"}, agentId=${ctx.agentId ?? "n/a"}`,
        );
        emitEvent({
          type: "automation-fired",
          ruleId: rule.id,
          ruleName: rule.name,
          trigger: trigger as import("@shared/types").AutomationTrigger,
          action: rule.action as import("@shared/types").AutomationAction,
        });
        log.info(`[automation] Fired rule "${rule.name}" (${trigger} → ${rule.action})`);
      } catch (err) {
        log.error(`[automation] Failed to execute action for rule "${rule.name}": ${err instanceof Error ? err.message : String(err)}`);
        db.recordAutomationExecution(
          rule.id, ctx.companyId, rule.name, trigger, rule.action,
          `FAILED: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        activeAutomationExecutions.delete(executionKey);
      }
    }
  } catch (err) {
    log.error(`[automation] Error evaluating rules for trigger "${trigger}": ${err instanceof Error ? err.message : String(err)}`);
  }
}

function matchesEventConfig(configJson: string, sourceDepartment: string | null, ctx: AutomationEventContext): boolean {
  if (sourceDepartment && ctx.department && sourceDepartment !== ctx.department) {
    return false;
  }
  try {
    const conditions = JSON.parse(configJson) as Record<string, unknown>;
    if (Object.keys(conditions).length === 0) return true;
    if (conditions.status && ctx.newStatus && conditions.status !== ctx.newStatus) return false;
    if (conditions.previousStatus && ctx.previousStatus && conditions.previousStatus !== ctx.previousStatus) return false;
    if (conditions.priority) {
      try {
        const task = ctx.taskId ? db.getTask(ctx.taskId) : null;
        if (task && task.priority !== conditions.priority) return false;
      } catch {
        return false;
      }
    }
    if (typeof conditions.budgetThresholdPct === "number" && ctx.agentId) {
      try {
        const agent = db.getAgent(ctx.agentId);
        if (agent.budgetMonthlyUsd > 0) {
          const utilization = agent.spentMonthlyUsd / agent.budgetMonthlyUsd;
          if (utilization < (conditions.budgetThresholdPct as number) / 100) return false;
        } else {
          return false;
        }
      } catch {
        return false;
      }
    }
    if (conditions.taskId && ctx.taskId && conditions.taskId !== ctx.taskId) return false;
    if (conditions.projectId && ctx.projectId && conditions.projectId !== ctx.projectId) return false;
    if (conditions.agentId && ctx.agentId && conditions.agentId !== ctx.agentId) return false;
    return true;
  } catch {
    return true;
  }
}

function matchesConditions(
  rule: { conditionsJson: string; sourceDepartment: string | null; targetDepartment: string | null },
  ctx: AutomationEventContext,
): boolean {
  void rule.targetDepartment;
  return matchesEventConfig(rule.conditionsJson, rule.sourceDepartment, ctx);
}

function evaluateWorkflowTriggers(trigger: string, ctx: AutomationEventContext) {
  try {
    const workflows = db.listTriggerableWorkflows(ctx.companyId, trigger);
    for (const workflow of workflows) {
      if (!matchesEventConfig(workflow.triggerConfigJson, null, ctx)) continue;
      const executionKey = [
        workflow.id,
        trigger,
        ctx.companyId,
        ctx.taskId ?? "-",
        ctx.agentId ?? "-",
        ctx.runId ?? "-",
        ctx.previousStatus ?? "-",
        ctx.newStatus ?? "-",
      ].join(":");
      if (activeWorkflowTriggerExecutions.has(executionKey)) {
        log.warn(`[workflow] Skipping re-entrant trigger for workflow "${workflow.name}" (${executionKey})`);
        continue;
      }
      activeWorkflowTriggerExecutions.add(executionKey);
      void runWorkflowPipeline(workflow.id, ctx.companyId)
        .then(() => {
          log.info(`[workflow] Triggered workflow "${workflow.name}" via ${trigger}`);
        })
        .catch((error) => {
          log.error(`[workflow] Trigger failed for "${workflow.name}": ${error instanceof Error ? error.message : String(error)}`);
        })
        .finally(() => {
          activeWorkflowTriggerExecutions.delete(executionKey);
        });
    }
  } catch (error) {
    log.error(`[workflow] Error evaluating workflow triggers for "${trigger}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

function dispatchAutomation(trigger: string, ctx: AutomationEventContext) {
  evaluateAutomationRules(trigger, ctx);
  evaluateWorkflowTriggers(trigger, ctx);
}

function executeAutomationAction(
  rule: { action: string; actionConfigJson: string; targetDepartment: string | null; trigger?: string },
  ctx: AutomationEventContext,
) {
  const config = (() => { try { return JSON.parse(rule.actionConfigJson) as Record<string, unknown>; } catch { return {}; } })();

  switch (rule.action) {
    case "assign_task": {
      if (ctx.taskId) {
        const assignedId = db.autoAssignTask(ctx.taskId, ctx.companyId);
        if (assignedId) {
          wakeAgentIfPossible(assignedId, ctx.companyId, "assignment");
        }
      } else if (ctx.agentId) {
        // No specific task — find unassigned tasks and assign to the idle agent
        const snapshot = db.listSnapshot();
        const unassigned = snapshot.tasks
          .filter((t) => t.companyId === ctx.companyId && !t.assigneeAgentId && ["backlog", "todo"].includes(t.status))
          .sort((a, b) => {
            const prio = { critical: 4, high: 3, medium: 2, low: 1 } as Record<string, number>;
            return (prio[b.priority] ?? 0) - (prio[a.priority] ?? 0);
          });
        if (unassigned.length > 0) {
          const task = unassigned[0];
          try {
            db.saveTask({
              id: task.id,
              companyId: task.companyId,
              projectId: task.projectId,
              goalId: task.goalId,
              parentId: task.parentId,
              title: task.title,
              description: task.description,
              assigneeAgentId: ctx.agentId,
              workspaceId: task.workspaceId,
              priority: task.priority,
              status: "todo",
            });
            wakeAgentIfPossible(ctx.agentId, ctx.companyId, "assignment");
            log.info(`[automation] Auto-assigned task "${task.title}" to idle agent ${ctx.agentId}`);
          } catch (err) {
            log.warn(`[automation] Failed to auto-assign task to idle agent: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
      break;
    }
    case "create_task": {
      const title = (config.title as string) ?? `[Auto] Task from automation rule`;
      const description = (config.description as string) ?? "";
      const priority = (config.priority as string) ?? "medium";
      const assigneeAgentId = (config.assigneeAgentId as string) ?? null;
      const taskId = db.saveTask({
        companyId: ctx.companyId,
        projectId: ctx.projectId ?? (config.projectId as string) ?? null,
        title,
        description,
        assigneeAgentId,
        priority,
        status: assigneeAgentId ? "todo" : "backlog",
      });
      if (assigneeAgentId) {
        wakeAgentIfPossible(assigneeAgentId, ctx.companyId, "assignment");
      } else {
        // No explicit assignee — try to auto-assign without triggering automation recursion
        const autoAssigned = db.autoAssignTask(taskId, ctx.companyId);
        if (autoAssigned) {
          wakeAgentIfPossible(autoAssigned, ctx.companyId, "assignment");
        }
      }
      log.info(`[automation] Created task: ${title} (${taskId})`);
      break;
    }
    case "notify_agent":
    case "send_message": {
      const toAgentId = (config.toAgentId as string) ?? ctx.agentId ?? null;
      const fromAgentId = (config.fromAgentId as string) ?? ctx.agentId ?? toAgentId;
      if (!fromAgentId) break;
      const channel = (config.channel as string) ?? (toAgentId ? "direct" : "company");
      // For department channel, auto-resolve dept from the agent if not specified
      let channelTargetId: string | null = (config.channelTargetId as string) ?? (config.department as string) ?? ctx.department ?? null;
      if (channel === "department" && !channelTargetId && fromAgentId) {
        try {
          const sender = db.getAgent(fromAgentId);
          channelTargetId = sender.department ?? null;
        } catch { /* ok */ }
      }
      db.sendAgentMessage({
        companyId: ctx.companyId,
        fromAgentId,
        toAgentId: channel === "direct" ? toAgentId : null,
        channel,
        channelTargetId,
        subject: (config.subject as string) ?? `Automation notification`,
        body: (config.body as string) ?? `Automation rule triggered for task ${ctx.taskId ?? "n/a"}`,
        priority: (config.priority as string) ?? "normal",
      });
      // Emit event so renderer updates in real-time
      const newMsg = db.listAgentMessages(ctx.companyId, { limit: 1 })?.[0];
      if (newMsg) emitEvent({ type: "new-message", message: newMsg });
      publishDomainChanged();
      if (toAgentId && channel === "direct") {
        wakeAgentIfPossible(toAgentId, ctx.companyId, "message");
      }
      break;
    }
    case "trigger_heartbeat": {
      let targetAgentId = (config.agentId as string) ?? null;
      if (!targetAgentId && ctx.agentId) {
        // If no explicit target, wake the agent from context.
        // But for run_completed/run_failed triggers, the context agent already just ran —
        // waking them again is redundant. Instead, wake their manager if possible.
        const triggerType = rule.trigger ?? "";
        if (triggerType === "run_completed" || triggerType === "run_failed") {
          const manager = db.getManagerForAgent(ctx.agentId);
          targetAgentId = manager?.id ?? ctx.agentId;
        } else {
          targetAgentId = ctx.agentId;
        }
      }
      if (targetAgentId) {
        wakeAgentIfPossible(targetAgentId, ctx.companyId, "manual");
      }
      break;
    }
    case "create_approval": {
      const approvalType = (config.approvalType as string) ?? "document_review";
      db.requestApproval({
        companyId: ctx.companyId,
        relatedTaskId: ctx.taskId ?? null,
        requestedByAgentId: ctx.agentId ?? null,
        type: approvalType,
        payloadSummary: (config.summary as string) ?? `Auto-generated approval request`,
        impactSummary: (config.impact as string) ?? `Triggered by automation rule`,
      });
      break;
    }
    case "update_task_status": {
      if (!ctx.taskId) break;
      const newStatus = (config.status as string) ?? "todo";
      db.advanceTaskStatus(ctx.taskId, newStatus, `Status changed by automation rule`);
      publishDomainChanged();
      // Propagate essential downstream effects without re-triggering automation (to prevent loops)
      try {
        const updatedTask = db.getTask(ctx.taskId);
        if (newStatus === "blocked" && updatedTask.assigneeAgentId) {
          const manager = db.getManagerForAgent(updatedTask.assigneeAgentId);
          if (manager) wakeAgentIfPossible(manager.id, ctx.companyId, "report_blocked");
        }
        if (newStatus === "in_review" && updatedTask.assigneeAgentId) {
          const manager = db.getManagerForAgent(updatedTask.assigneeAgentId);
          if (manager) wakeAgentIfPossible(manager.id, ctx.companyId, "subtask_completed");
        }
        if (newStatus === "todo" && updatedTask.assigneeAgentId) {
          wakeAgentIfPossible(updatedTask.assigneeAgentId, ctx.companyId, "assignment");
        }
        if (newStatus === "done" && updatedTask.parentId) {
          const snapshot = db.listSnapshot();
          const siblings = snapshot.tasks.filter((t) => t.parentId === updatedTask.parentId && t.companyId === ctx.companyId);
          const allDone = siblings.every((t) => t.id === ctx.taskId ? true : t.status === "done");
          if (allDone) {
            const parent = db.getTask(updatedTask.parentId);
            if (parent.assigneeAgentId) wakeAgentIfPossible(parent.assigneeAgentId, ctx.companyId, "subtask_completed");
          }
        }
      } catch { /* task may not exist */ }
      break;
    }
    case "escalate_to_manager": {
      const targetAgentId = ctx.agentId;
      if (!targetAgentId) break;
      const manager = db.getManagerForAgent(targetAgentId);
      if (manager) {
        let agentName = "an agent";
        try { agentName = db.getAgent(targetAgentId).name; } catch { /* ok */ }
        let taskTitle = ctx.taskId ?? "unknown";
        try { if (ctx.taskId) taskTitle = db.getTask(ctx.taskId).title; } catch { /* ok */ }
        db.sendAgentMessage({
          companyId: ctx.companyId,
          fromAgentId: targetAgentId,
          toAgentId: manager.id,
          channel: "direct",
          subject: `Escalation from ${agentName}: ${taskTitle}`,
          body: (config.body as string) ?? `Task "${taskTitle}" needs your attention. ${agentName} has flagged this as requiring manager intervention.`,
          priority: "urgent",
        });
        publishDomainChanged();
        wakeAgentIfPossible(manager.id, ctx.companyId, "report_blocked");
      }
      break;
    }
    case "cross_department_notify": {
      const targetDept = rule.targetDepartment ?? (config.department as string);
      if (!targetDept) break;
      const deptAgents = db.getIdleAgentsForDepartment(ctx.companyId, targetDept);
      // Send a single channel message visible to entire department
      const senderAgentId = ctx.agentId ?? deptAgents[0]?.id;
      if (senderAgentId) {
        db.sendAgentMessage({
          companyId: ctx.companyId,
          fromAgentId: senderAgentId,
          toAgentId: null,
          channel: "department",
          channelTargetId: targetDept,
          subject: (config.subject as string) ?? `Cross-department notification`,
          body: (config.body as string) ?? `Automation triggered a cross-department alert.`,
          priority: "normal",
        });
        publishDomainChanged();
      }
      // Wake agents in the target department
      for (const agent of deptAgents.slice(0, 5)) {
        wakeAgentIfPossible(agent.id, ctx.companyId, "message");
      }
      break;
    }
    case "schedule_meeting": {
      const meetingType = (config.meetingType as string) ?? "department_sync";
      const title = (config.title as string) ?? `Auto-scheduled meeting`;
      db.saveMeeting({
        companyId: ctx.companyId,
        type: meetingType,
        title,
        organizerAgentId: ctx.agentId ?? null,
        participantAgentIds: (config.participantAgentIds as string) ?? "[]",
        scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
        durationMinutes: (config.durationMinutes as number) ?? 30,
      });
      break;
    }
    case "create_document": {
      const docType = (config.documentType as string) ?? "status_report";
      const title = (config.title as string) ?? `Auto-generated document`;
      db.saveDocument({
        companyId: ctx.companyId,
        type: docType,
        title,
        content: (config.content as string) ?? "",
        authorAgentId: ctx.agentId ?? null,
        projectId: ctx.projectId ?? null,
      });
      break;
    }
    case "auto_approve": {
      const snapshot = db.listSnapshot();
      const pendingApprovals = snapshot.approvals.filter(
        (a) => a.companyId === ctx.companyId && a.state === "pending",
      );
      for (const approval of pendingApprovals.slice(0, 5)) {
        db.decideApproval({ companyId: ctx.companyId, approvalId: approval.id, state: "approved", decisionNote: "Auto-approved by automation rule." });
        handleApprovalResolved(approval.id, ctx.companyId, "approved");
      }
      break;
    }
    case "reassign_task": {
      if (!ctx.taskId) break;
      const newAssignee = db.autoAssignTask(ctx.taskId, ctx.companyId);
      if (newAssignee) {
        wakeAgentIfPossible(newAssignee, ctx.companyId, "assignment");
      }
      break;
    }
    case "run_task": {
      const targetTaskId = (config.taskId as string) ?? ctx.taskId;
      if (!targetTaskId) break;
      try {
        const task = db.getTask(targetTaskId);
        if (!task.assigneeAgentId) break;
        wakeAgentIfPossible(task.assigneeAgentId, ctx.companyId, "assignment");
      } catch { /* task may not exist */ }
      break;
    }
    default:
      log.warn(`[automation] Unknown action: ${rule.action}`);
  }
}

// ── Run Result Processing ─────────────────────────────────────────────

function processRunCompletion(run: RunRecord, event: z.infer<typeof workerMessageSchema> & { type: "run-finished" }) {
  let task: ReturnType<typeof db.getTask> | null = null;
  try { task = db.getTask(run.taskId); } catch { return; }
  if (!task) return;

  const isSuccess = event.status === "succeeded";
  const isFailed = event.status === "failed" || event.status === "timed_out";

  // Auto-advance task on successful run: in_progress → in_review
  if (isSuccess && task.status === "in_progress") {
    db.advanceTaskStatus(task.id, "in_review", `Run completed successfully. Awaiting review.`);
    publishDomainChanged();

    // Wake the manager to review the work
    if (task.assigneeAgentId) {
      const manager = db.getManagerForAgent(task.assigneeAgentId);
      if (manager) {
        db.sendAgentMessage({
          companyId: run.companyId,
          fromAgentId: task.assigneeAgentId,
          toAgentId: manager.id,
          channel: "direct",
          subject: `Review requested: ${task.title}`,
          body: `Task "${task.title}" has been completed and is ready for review.\n\nRun summary: ${event.summary ?? "No summary available."}`,
          priority: "normal",
        });
        wakeAgentIfPossible(manager.id, run.companyId, "subtask_completed");
      }
    }
  }

  // On successful heartbeat check-work task, clean up if no real work done
  if (isSuccess && task.title.startsWith("[Heartbeat]") && task.status !== "done") {
    db.advanceTaskStatus(task.id, "done", "Heartbeat check completed.");
  }

  const automationCtx: AutomationEventContext = {
    companyId: run.companyId,
    taskId: run.taskId,
    agentId: run.agentId,
    runId: run.id,
    costUsd: event.costUsd ?? undefined,
  };
  try {
    const agent = db.getAgent(run.agentId);
    automationCtx.department = agent.department ?? undefined;
  } catch { /* agent may be deleted */ }

  if (isSuccess) {
    dispatchAutomation("run_completed", automationCtx);

    // Check if all subtasks of a parent task are done — use fresh snapshot since task status just changed
    if (task.parentId) {
      try {
        const freshSnapshot = db.listSnapshot();
        const siblings = freshSnapshot.tasks.filter((t) => t.parentId === task!.parentId && t.companyId === run.companyId);
        const allSiblingsDoneOrReview = siblings.every((t) => t.status === "done" || t.status === "in_review");
        if (allSiblingsDoneOrReview) {
          const parent = db.getTask(task.parentId);
          if (parent.assigneeAgentId) {
            wakeAgentIfPossible(parent.assigneeAgentId, run.companyId, "subtask_completed");
          } else {
            // Parent has no assignee — auto-assign to the agent who would be responsible
            const assignedId = db.autoAssignTask(parent.id, run.companyId);
            if (assignedId) {
              wakeAgentIfPossible(assignedId, run.companyId, "subtask_completed");
            }
          }
        }
      } catch { /* parent may be deleted */ }
    }
  }

  if (isFailed) {
    dispatchAutomation("run_failed", automationCtx);
  }

  // Budget threshold check after cost is recorded
  if (event.costUsd && event.costUsd > 0) {
    try {
      const agent = db.getAgent(run.agentId);
      if (agent.budgetMonthlyUsd > 0) {
        const utilization = agent.spentMonthlyUsd / agent.budgetMonthlyUsd;
        if (utilization >= 0.8) {
          dispatchAutomation("budget_threshold", {
            ...automationCtx,
            agentId: agent.id,
          });
        }
      }
    } catch { /* agent deleted */ }
  }
}

function handleApprovalResolved(approvalId: string, companyId: string, decision: string) {
  const snapshot = db.listSnapshot();
  const approval = snapshot.approvals.find((a) => a.id === approvalId);
  if (!approval) return;

  dispatchAutomation("approval_resolved", {
    companyId,
    agentId: approval.requestedByAgentId ?? undefined,
    taskId: approval.relatedTaskId ?? undefined,
  });

  // `db.decideApproval` already updates the hire target. This path only emits
  // post-resolution side effects once the DB state is committed.
  if (approval.type === "hire_agent" && decision === "approved" && approval.relatedAgentId) {
    try {
      const agent = db.getAgent(approval.relatedAgentId);
      if (agent.status === "idle") {
        db.addActivity({
          companyId,
          actor: "system",
          action: "agent.hired",
          entityType: "agent",
          entityId: agent.id,
          detail: `${agent.name} hire approved and activated.`,
        });
        dispatchAutomation("hire_approved", {
          companyId,
          agentId: agent.id,
        });
        // Wake the new agent so they check in
        wakeAgentIfPossible(agent.id, companyId, "assignment");
        publishDomainChanged();
        notify("New agent hired", `${agent.name} (${agent.role}) has joined the company.`);
      }
    } catch { /* agent may be deleted */ }
  }

  const browserAction = db.getBrowserActionByApprovalId(approvalId, companyId);
  if (browserAction) {
    if (decision === "approved") {
      db.updateBrowserAction(browserAction.id, {
        status: "queued",
        resultSummary: "Approval granted. Dispatching browser action.",
        errorMessage: null,
      });
      publishDomainChanged();
      void dispatchBrowserAction(browserAction.id, companyId).catch((error) => {
        log.error(`[browser] Failed to dispatch approved browser action ${browserAction.id}: ${error instanceof Error ? error.message : String(error)}`);
      });
    } else if (decision === "rejected") {
      db.updateBrowserAction(browserAction.id, {
        status: "cancelled",
        resultSummary: "Browser action was rejected during approval.",
        errorMessage: "Approval rejected by board.",
        finishedAt: new Date().toISOString(),
      });
      publishDomainChanged();
    } else if (decision === "revision_requested") {
      db.updateBrowserAction(browserAction.id, {
        status: "approval_required",
        resultSummary: "Board requested revisions before execution.",
        errorMessage: "Approval requires revisions before the browser action can run.",
      });
      publishDomainChanged();
    }
  }

  if (approval.payloadJson) {
    try {
      const payload = JSON.parse(approval.payloadJson) as { workflowId?: string; stepId?: string };
      if (payload.workflowId && payload.stepId) {
        const workflow = db.getWorkflowRecord(payload.workflowId, companyId);
        if (workflow) {
          const steps = normalizeWorkflowSteps(JSON.parse(workflow.stepsJson || "[]"));
          const stepIndex = steps.findIndex((step) => step.id === payload.stepId);
          if (stepIndex >= 0) {
            if (decision === "approved") {
              steps[stepIndex]!.status = "pending";
              db.updateWorkflowExecution({
                id: workflow.id,
                companyId,
                status: "paused",
                currentStepIndex: stepIndex,
                stepsJson: JSON.stringify(steps),
                lastRunAt: workflow.lastRunAt,
              });
              publishDomainChanged();
              void runWorkflowPipeline(workflow.id, companyId).catch((error) => {
                log.error(`[workflow] Failed to resume workflow ${workflow.id} after approval ${approvalId}: ${error instanceof Error ? error.message : String(error)}`);
              });
            } else {
              steps[stepIndex]!.status = decision === "revision_requested" ? "pending" : "failed";
              db.updateWorkflowExecution({
                id: workflow.id,
                companyId,
                status: decision === "revision_requested" ? "paused" : "failed",
                currentStepIndex: stepIndex,
                stepsJson: JSON.stringify(steps),
                lastRunAt: workflow.lastRunAt,
              });
              publishDomainChanged();
            }
          }
        }
      }
    } catch {
      // Non-workflow approvals may use payloadJson for other purposes.
    }
  }

  // Wake the requesting agent to inform them of the decision
  if (approval.requestedByAgentId) {
    wakeAgentIfPossible(approval.requestedByAgentId, companyId, "approval_resolved");
  }
}

function handleTaskStatusChange(taskId: string, companyId: string, previousStatus: string, newStatus: string) {
  if (previousStatus === newStatus) return;

  let task: ReturnType<typeof db.getTask> | null = null;
  try { task = db.getTask(taskId); } catch { return; }
  if (!task) return;

  db.addActivity({
    companyId,
    actor: task.assigneeAgentId ?? "board",
    action: "task.status_changed",
    entityType: "task",
    entityId: taskId,
    detail: `${previousStatus} → ${newStatus}`,
  });

  const ctx: AutomationEventContext = {
    companyId,
    taskId,
    agentId: task.assigneeAgentId ?? undefined,
    previousStatus,
    newStatus,
  };
  try {
    if (task.assigneeAgentId) {
      const agent = db.getAgent(task.assigneeAgentId);
      ctx.department = agent.department ?? undefined;
    }
  } catch { /* agent deleted */ }

  dispatchAutomation("task_status_changed", ctx);

  if (newStatus === "blocked") {
    dispatchAutomation("task_blocked", ctx);
    // Auto-escalate blocked tasks to manager
    if (task.assigneeAgentId) {
      const manager = db.getManagerForAgent(task.assigneeAgentId);
      if (manager) {
        wakeAgentIfPossible(manager.id, companyId, "report_blocked");
      }
    }
  }

  // When task enters in_review, wake the manager to review
  if (newStatus === "in_review" && task.assigneeAgentId) {
    const manager = db.getManagerForAgent(task.assigneeAgentId);
    if (manager) {
      wakeAgentIfPossible(manager.id, companyId, "subtask_completed");
    }
  }

  // When task is assigned (status change to todo with an assignee), wake the agent
  if (newStatus === "todo" && task.assigneeAgentId) {
    wakeAgentIfPossible(task.assigneeAgentId, companyId, "assignment");
  }

  // When a subtask is completed (done), check if all sibling subtasks are also done.
  // If so, wake the parent task's assignee — this enables the full task completion cascade
  // even when tasks are approved manually (not just via agent run completion).
  if (newStatus === "done" && task.parentId) {
    try {
      const snapshot = db.listSnapshot();
      const siblings = snapshot.tasks.filter((t) => t.parentId === task!.parentId && t.companyId === companyId);
      const allDone = siblings.every((t) => t.id === taskId ? true : t.status === "done");
      if (allDone) {
        const parent = db.getTask(task.parentId);
        if (parent.assigneeAgentId) {
          wakeAgentIfPossible(parent.assigneeAgentId, companyId, "subtask_completed");
        } else {
          const assignedId = db.autoAssignTask(parent.id, companyId);
          if (assignedId) {
            wakeAgentIfPossible(assignedId, companyId, "subtask_completed");
          }
        }
      }
    } catch { /* parent may be deleted */ }
  }
}

function handleTaskCreated(taskId: string, companyId: string) {
  let task: ReturnType<typeof db.getTask> | null = null;
  try { task = db.getTask(taskId); } catch { return; }
  if (!task) return;

  dispatchAutomation("task_created", {
    companyId,
    taskId,
    agentId: task.assigneeAgentId ?? undefined,
  });

  if (!task.assigneeAgentId) {
    const assignedId = db.autoAssignTask(taskId, companyId);
    if (assignedId) {
      wakeAgentIfPossible(assignedId, companyId, "assignment");
    }
  } else {
    wakeAgentIfPossible(task.assigneeAgentId, companyId, "assignment");
  }
}

function generateInitialCompanyMessages(
  companyId: string,
  template: { name: string; agents: Array<{ name: string; role: string; title: string; department: string }> },
  agentIds: string[],
) {
  try {
    const ceoId = agentIds[0];
    const ceoName = template.agents[0]?.name ?? "CEO";

    // CEO sends company-wide welcome
    db.sendAgentMessage({
      companyId,
      fromAgentId: ceoId,
      toAgentId: null,
      channel: "company",
      subject: `Welcome to ${template.name}`,
      body: `Team, I'm ${ceoName} and I'm excited to kick off our company. Our mission is clear and our team is assembled. Each department lead: please introduce your team in your department channel and outline your initial priorities. Let's build something great together.`,
      priority: "normal",
    });

    // Group agents by department and have leads introduce themselves
    const deptAgents = new Map<string, Array<{ id: string; name: string; role: string; title: string; index: number }>>();
    for (let i = 0; i < template.agents.length; i++) {
      const def = template.agents[i];
      const dept = def.department;
      if (!deptAgents.has(dept)) deptAgents.set(dept, []);
      deptAgents.get(dept)!.push({ id: agentIds[i], name: def.name, role: def.role, title: def.title, index: i });
    }

    for (const [dept, members] of deptAgents) {
      if (dept === "executive" && members.length <= 1) continue; // Skip if only CEO
      const lead = members[0]; // First agent in department is the lead
      const otherMembers = members.slice(1);
      const memberList = otherMembers.length > 0
        ? `Our team: ${otherMembers.map((m) => `${m.name} (${m.title})`).join(", ")}.`
        : "I'm currently the sole member of this department.";

      db.sendAgentMessage({
        companyId,
        fromAgentId: lead.id,
        toAgentId: null,
        channel: "department",
        channelTargetId: dept,
        subject: `${dept.charAt(0).toUpperCase() + dept.slice(1).replace("_", " ")} department reporting in`,
        body: `I'm ${lead.name}, ${lead.title}. ${memberList} We're ready to start executing on our goals. I'll be coordinating our work and reporting progress here.`,
        priority: "normal",
      });

      // Each non-lead member sends a brief introduction
      for (const member of otherMembers) {
        db.sendAgentMessage({
          companyId,
          fromAgentId: member.id,
          toAgentId: null,
          channel: "department",
          channelTargetId: dept,
          subject: `Introduction`,
          body: `Hello team, I'm ${member.name}, ${member.title}. Ready to contribute. Looking forward to working with everyone.`,
          priority: "low",
        });
      }
    }

    // CEO sends a strategy message
    db.sendAgentMessage({
      companyId,
      fromAgentId: ceoId,
      toAgentId: null,
      channel: "company",
      subject: "Initial priorities and next steps",
      body: `Here's our immediate game plan:\n\n1. All department leads: review our company goals and identify your department's top 3 priorities\n2. Engineering: set up workspaces and assess our technical infrastructure\n3. Product: draft initial requirements for our first deliverable\n4. All agents: check your assigned tasks and begin execution\n\nI'll be reviewing progress and providing direction. Don't hesitate to escalate blockers — speed matters more than perfection right now.`,
      priority: "normal",
    });

    // Department leads report back to CEO with initial priorities
    for (const [dept, members] of deptAgents) {
      if (dept === "executive") continue;
      const lead = members[0];
      if (!lead) continue;

      db.sendAgentMessage({
        companyId,
        fromAgentId: lead.id,
        toAgentId: ceoId,
        channel: "direct",
        subject: `${dept.replace("_", " ")} department initial assessment`,
        body: `${ceoName}, this is ${lead.name} from the ${dept.replace("_", " ")} department. I've reviewed our company goals and I'm ready to break them down into actionable tasks for my team. I'll start creating tasks and assigning work to my direct reports immediately. Will report back with our sprint plan shortly.`,
        priority: "normal",
      });
    }

    log.info(`[company] Generated initial messages for company ${companyId}`);
  } catch (err) {
    log.error(`[company] Failed to generate initial messages: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function startHeartbeatScheduler() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);

  heartbeatTimer = setInterval(() => {
    try {
      if (!worker) return;
      const snapshot = db.listSnapshot();
      const now = Date.now();

      for (const company of snapshot.companies.filter((entry) => entry.status === "active")) {
        try {
          const eligibleAgents = db.listHeartbeatEligibleAgents(company.id);
          for (const agent of eligibleAgents) {
            if (hasActiveRun(snapshot, { agentId: agent.id, companyId: company.id })) continue;

            const lastHeartbeat = agent.lastHeartbeatAt ? new Date(agent.lastHeartbeatAt).getTime() : 0;
            const intervalMs = agent.heartbeatIntervalSec * 1000;
            if (now - lastHeartbeat < intervalMs) continue;

            log.info(`[heartbeat] Waking agent ${agent.name} (interval: ${agent.heartbeatIntervalSec}s)`);
            startAgentHeartbeatRun(agent.id, company.id, "timer");
          }
          // Company bootstrap: if goals exist but no active tasks, force-wake the CEO
          // This ensures the company starts running even without manual intervention
          const companyGoals = snapshot.goals.filter((g) => g.companyId === company.id && (g.status === "active" || g.status === "planned"));
          const companyActiveTasks = snapshot.tasks.filter((t) => t.companyId === company.id && !["done", "cancelled"].includes(t.status) && !t.title.startsWith("[Heartbeat]"));
          if (companyGoals.length > 0 && companyActiveTasks.length === 0) {
            const ceo = snapshot.agents.find((a) => a.companyId === company.id && !a.reportsTo && a.status !== "terminated");
            const ceoLastWake = ceo?.lastHeartbeatAt ? new Date(ceo.lastHeartbeatAt).getTime() : 0;
            const bootstrapCooldown = 120_000; // 2 minutes between bootstrap attempts
            if (ceo && !hasActiveRun(snapshot, { agentId: ceo.id, companyId: company.id }) && (now - ceoLastWake > bootstrapCooldown)) {
              log.info(`[heartbeat] Company ${company.name} has ${companyGoals.length} goals but no tasks — bootstrapping CEO ${ceo.name}`);
              startAgentHeartbeatRun(ceo.id, company.id, "bootstrap");
            }
          }

          // Rate-limit schedule rules to once per 60 seconds per company
          const scheduleKey = `schedule-${company.id}`;
          const lastScheduleFired = (scheduleLastFiredMap as Map<string, number>).get(scheduleKey) ?? 0;
          if (now - lastScheduleFired >= 60_000) {
            dispatchAutomation("schedule", { companyId: company.id });
            (scheduleLastFiredMap as Map<string, number>).set(scheduleKey, now);
          }

          // Check for idle agents — agents with no tasks and no recent runs
          const companyAgents = snapshot.agents.filter((a) => a.companyId === company.id && a.status !== "terminated" && a.status !== "paused" && a.status !== "pending_approval");
          for (const agent of companyAgents) {
            const hasAssigned = snapshot.tasks.some(
              (t) => t.assigneeAgentId === agent.id && t.companyId === company.id && ["todo", "in_progress", "blocked"].includes(t.status),
            );
            if (!hasAssigned) {
              const lastActive = agent.lastHeartbeatAt ? new Date(agent.lastHeartbeatAt).getTime() : 0;
              const idleThreshold = 20 * 60 * 1000; // 20 minutes (must exceed 2x max heartbeat interval to avoid false positives)
              if (now - lastActive > idleThreshold) {
                dispatchAutomation("agent_idle", {
                  companyId: company.id,
                  agentId: agent.id,
                  department: agent.department ?? undefined,
                });
              }
            }
          }

          // Monthly budget reset — persisted in database to survive app restarts
          const currentMonth = new Date().toISOString().slice(0, 7); // "2026-03"
          const lastResetMonth = db.getLastBudgetResetMonth(company.id) ?? "";
          if (currentMonth !== lastResetMonth) {
            db.resetMonthlyBudgets(company.id);
            db.setLastBudgetResetMonth(company.id, currentMonth);
            log.info(`[heartbeat] Reset monthly budgets for company ${company.name} (${currentMonth})`);
          }
        } catch (companyError) {
          log.error(`[heartbeat] Error processing company ${company.id}: ${companyError instanceof Error ? companyError.message : String(companyError)}`);
        }
      }
      // Periodic cleanup: release stale workspace locks (held >2h) and expired pending wakes
      try {
        const staleReleased = db.releaseStaleWorkspaceLocks();
        if (staleReleased > 0) {
          log.info(`[heartbeat] Released ${staleReleased} stale workspace lock(s)`);
          publishDomainChanged();
        }
      } catch (cleanupErr) {
        log.error(`[heartbeat] Stale lock cleanup failed: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`);
      }
    } catch (error) {
      log.error(`[heartbeat] Scheduler error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, 15_000);
}

function dispatchRunToWorker(params: {
  runId: string;
  companyId: string;
  agent: ReturnType<typeof db.getAgent>;
  task: ReturnType<typeof db.getTask>;
  connector: ReturnType<typeof db.getConnector>;
  workspace: ReturnType<typeof db.getWorkspace> | null;
  workspaceMode: WorkspaceLockMode;
  companyName: string;
  companyDescription: string;
  snapshot: ReturnType<typeof db.listSnapshot>;
  trigger: string;
}) {
  const { runId, companyId, agent, task, connector, workspace, workspaceMode, companyName, companyDescription, snapshot, trigger } = params;
  if (!worker) {
    throw new Error("Orchestration worker is not ready.");
  }

  const env = db.resolveSecretEnv(connector.envBindingText, companyId);
  const apiPort = apiServer?.getPort() ?? 0;
  const apiUrl = apiPort ? `http://127.0.0.1:${apiPort}` : "";
  const apiKey = apiUrl ? createAgentToken(agent.id, companyId, runId) : "";

  const assignedTasks = db.listAgentTasks(agent.id, companyId, ["todo", "in_progress", "blocked"]);
  const recentComments = snapshot.comments
    .filter((c) => assignedTasks.some((t) => t.id === c.taskId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 20)
    .map((c) => ({
      taskId: c.taskId,
      taskTitle: assignedTasks.find((t) => t.id === c.taskId)?.title ?? c.taskId,
      authorName: c.authorName,
      body: c.body,
      createdAt: c.createdAt,
    }));

  const systemPrompt = apiUrl ? buildTaskPrompt({
    agent,
    apiUrl,
    apiKey,
    runId,
    task,
    companyName,
    goals: snapshot.goals.filter((g) => g.companyId === companyId),
    projects: snapshot.projects.filter((p) => p.companyId === companyId),
    directReports: db.getDirectReports(agent.id, companyId),
    chainOfCommand: db.getChainOfCommand(agent.id),
    assignedTasks,
    allAgents: snapshot.agents.filter((a) => a.companyId === companyId),
    pendingApprovals: snapshot.approvals.filter(
      (a) => a.companyId === companyId &&
        a.requestedByAgentId === agent.id &&
        (a.state === "pending" || a.state === "revision_requested"),
    ),
    tasksAwaitingReview: db.listReviewTasksForManager(agent.id, companyId),
    wakeReason: trigger,
    allTasks: snapshot.tasks.filter((t) => t.companyId === companyId),
    recentComments,
    companyDescription,
    socialAccounts: db.listSocialAccounts(companyId).map((a) => ({
      id: a.id,
      platform: a.platform,
      accountName: a.accountName,
      status: a.status,
      requireApproval: a.requireApproval,
    })),
    recentMessages: db.listAgentMessages(companyId, { agentId: agent.id, limit: 15 }),
    upcomingMeetings: snapshot.meetings
      .filter((m) => m.companyId === companyId && (m.status === "scheduled" || m.status === "in_progress"))
      .filter((m) => {
        try {
          const ids: string[] = JSON.parse(m.participantAgentIds);
          return ids.includes(agent.id) || m.organizerAgentId === agent.id;
        } catch {
          return false;
        }
      })
      .slice(0, 5),
    relevantKnowledge: snapshot.knowledgeBase
      .filter((k) => k.companyId === companyId && (k.importance === "critical" || k.importance === "high"))
      .slice(0, 8),
    activeSprint: snapshot.sprints.find((s) => s.companyId === companyId && s.status === "active") ?? null,
    recentDocuments: snapshot.documents
      .filter((d) => d.companyId === companyId && (d.authorAgentId === agent.id || d.reviewerAgentId === agent.id || d.status === "in_review"))
      .slice(0, 5),
  }) : null;

  if (apiUrl) {
    env.AGENT_COMPANY_API_URL = apiUrl;
    env.AGENT_COMPANY_API_KEY = apiKey;
    env.AGENT_COMPANY_AGENT_ID = agent.id;
    env.AGENT_COMPANY_COMPANY_ID = companyId;
    env.AGENT_COMPANY_RUN_ID = runId;
    env.AGENT_COMPANY_TASK_ID = task.id;
    env.AGENT_COMPANY_WAKE_REASON = trigger;
  }

  const taskSession = db.getTaskSession(task.id);
  let thinkingEffort: string | null = null;
  try {
    const meta = JSON.parse(agent.metadataJson || "{}");
    if (typeof meta.thinkingEffort === "string" && meta.thinkingEffort) {
      thinkingEffort = meta.thinkingEffort;
    }
  } catch { /* malformed metadata */ }

  worker.postMessage({
    type: "enqueue-run",
    payload: {
      runId,
      companyId,
      taskId: task.id,
      taskTitle: task.title,
      taskDescription: task.description,
      agentId: agent.id,
      agentName: agent.name,
      connectorId: connector.id,
      workspaceId: workspace?.id ?? null,
      workspacePath: workspace?.localPath ?? null,
      workspaceMode,
      command: connector.command,
      model: connector.model ?? agent.model,
      thinkingEffort,
      env,
      sessionParams: taskSession.sessionParams,
      systemPrompt,
      trigger,
    },
  });
}

function registerHandlers() {
  registerHandle(IPC_CHANNELS.loadSnapshot, () => ok(db.listRendererSnapshot()));

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
        department: parsed.department ?? null,
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
    const isNew = !parsed.id;
    let previousStatus: string | null = null;
    if (!isNew) {
      try {
        const existing = db.getTask(parsed.id!);
        previousStatus = existing.status;
      } catch { /* task is new */ }
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
      action: isNew ? "task.created" : "task.updated",
      entityType: "task",
      entityId: id,
      detail: parsed.title,
    });
    if (isNew) {
      handleTaskCreated(id, parsed.companyId);
    } else if (previousStatus && previousStatus !== parsed.status) {
      handleTaskStatusChange(id, parsed.companyId, previousStatus, parsed.status);
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
    const approval = snapshot.approvals.find((entry) => entry.id === parsed.approvalId && entry.companyId === parsed.companyId);
    if (approval) {
      db.addActivity({
        companyId: approval.companyId,
        actor: "board",
        action: `approval.${parsed.state}`,
        entityType: "approval",
        entityId: approval.id,
        detail: parsed.decisionNote,
      });
      handleApprovalResolved(parsed.approvalId, approval.companyId, parsed.state);
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
    if (task.activeRunId || hasActiveRun(snapshot, { taskId: task.id, companyId: task.companyId })) {
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
    if (hasActiveRun(snapshot, { agentId: agent.id, companyId: task.companyId })) {
      return fail("AGENT_ALREADY_RUNNING", "The assigned agent already has an active run.");
    }

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

    const workspaceResolution = resolveWorkspace(task, agent, task.companyId);
    const workspace = workspaceResolution.workspace;

    log.info(
      `[run] Workspace resolution for ${agent.name}: task.workspaceId=${task.workspaceId ?? "null"}, agent.workspaceId=${agent.workspaceId ?? "null"}, projectId=${task.projectId ?? "null"}, source=${workspaceResolution.source}, mode=${workspaceResolution.lockMode}, resolved=${workspace?.name ?? "NONE"}, localPath=${workspace?.localPath ?? "NONE"}`,
    );

    if (workspace && workspace.companyId !== task.companyId) {
      return fail("WORKSPACE_COMPANY_MISMATCH", "The selected workspace does not belong to the task company.");
    }

    const run = db.createRun({
      companyId: task.companyId,
      taskId: task.id,
      agentId: agent.id,
      workspaceId: workspaceResolution.lockMode === "exclusive" ? (workspace?.id ?? null) : null,
      connectorId: connector.id,
    });

    const manualCompany = snapshot.companies.find((c) => c.id === task.companyId);
    dispatchRunToWorker({
      runId: run.id,
      companyId: task.companyId,
      agent,
      task,
      connector,
      workspace,
      workspaceMode: workspaceResolution.lockMode,
      companyName: manualCompany?.name ?? "Company",
      companyDescription: manualCompany?.description ?? "",
      snapshot,
      trigger: "manual",
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

  registerHandle(IPC_CHANNELS.cancelRun, (_event, payload) => {
    const parsed = cancelRunSchema.parse(payload);
    worker?.postMessage({ type: "cancel-run", runId: parsed.runId });
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.getRunLog, (_event, payload) => {
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
    const hasActiveRuns = db.listSnapshot().runs.some((run) => run.status === "queued" || run.status === "running");
    if (hasActiveRuns) {
      return fail("RESTORE_BLOCKED", "Stop all active runs before restoring a profile backup.");
    }
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

  const deleteHandlers: Array<{
    channel: string;
    table: CompanyScopedTable;
    entity: string;
    deleteFn: (id: string, companyId: string) => void;
  }> = [
    { channel: IPC_CHANNELS.deleteAgent, table: "agents", entity: "agent", deleteFn: (id, cid) => db.deleteAgent(id, cid) },
    { channel: IPC_CHANNELS.deleteTask, table: "tasks", entity: "task", deleteFn: (id, cid) => db.deleteTask(id, cid) },
    { channel: IPC_CHANNELS.deleteGoal, table: "goals", entity: "goal", deleteFn: (id, cid) => db.deleteGoal(id, cid) },
    { channel: IPC_CHANNELS.deleteProject, table: "projects", entity: "project", deleteFn: (id, cid) => db.deleteProject(id, cid) },
    { channel: IPC_CHANNELS.deleteWorkspace, table: "workspaces", entity: "workspace", deleteFn: (id, cid) => db.deleteWorkspace(id, cid) },
    { channel: IPC_CHANNELS.deleteApproval, table: "approvals", entity: "approval", deleteFn: (id, cid) => db.deleteApproval(id, cid) },
    { channel: IPC_CHANNELS.deleteSecret, table: "secrets", entity: "secret", deleteFn: (id, cid) => db.deleteSecret(id, cid) },
  ];
  for (const { channel, table, entity, deleteFn } of deleteHandlers) {
    registerHandle(channel, async (_event, payload) => {
      const parsed = deleteEntitySchema.parse(payload);
      const companyError = ensureCompanyExists(parsed.companyId);
      if (companyError) return companyError;
      if (!db.belongsToCompany(table, parsed.id, parsed.companyId)) {
        return fail(`${entity.toUpperCase()}_NOT_FOUND`, `${entity.charAt(0).toUpperCase() + entity.slice(1)} not found in the current company.`);
      }
      deleteFn(parsed.id, parsed.companyId);
      db.addActivity({ companyId: parsed.companyId, actor: "board", action: `${entity}.deleted`, entityType: entity, entityId: parsed.id, detail: "" });
      publishDomainChanged();
      return ok(true);
    });
  }

  registerHandle(IPC_CHANNELS.getSidebarBadges, async (_event, companyId) => {
    let parsedCompanyId: string;
    try {
      parsedCompanyId = companyIdSchema.parse(companyId);
    } catch {
      return fail("INVALID_COMPANY_ID", "A valid company id is required.");
    }
    return ok(db.getSidebarBadges(parsedCompanyId));
  });

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

    try {
      const task = db.getTask(parsed.taskId);
      if (task.assigneeAgentId) {
        wakeAgentIfPossible(task.assigneeAgentId, task.companyId, "comment");
      }
      dispatchAutomation("comment_posted", {
        companyId: parsed.companyId,
        taskId: parsed.taskId,
        agentId: parsed.authorAgentId ?? undefined,
      });
    } catch { /* ignore if task not found */ }

    return ok(comment.id);
  });

  registerHandle(IPC_CHANNELS.listComments, async (_event, payload) => {
    const parsed = listCommentsSchema.parse(payload);
    return ok(db.listComments(parsed.taskId));
  });

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

  registerHandle(IPC_CHANNELS.getApiPort, () => {
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

  registerHandle(IPC_CHANNELS.getInbox, (_event, payload) => {
    const companyId = companyIdSchema.parse(payload);
    const err = ensureCompanyExists(companyId);
    if (err) return err;
    return ok(db.getInbox(companyId));
  });

  registerHandle(IPC_CHANNELS.getCompanyMetrics, (_event, payload) => {
    const input = metricsQuerySchema.parse(payload);
    const err = ensureCompanyExists(input.companyId);
    if (err) return err;
    return ok(db.getCompanyMetrics(input.companyId, input.days));
  });

  registerHandle(IPC_CHANNELS.getAgentMetrics, (_event, payload) => {
    const input = metricsQuerySchema.parse(payload);
    const err = ensureCompanyExists(input.companyId);
    if (err) return err;
    if (!input.agentId) return fail("MISSING_AGENT_ID", "agentId is required");
    const metrics = db.getCompanyMetrics(input.companyId, input.days);
    const agentMetric = metrics.agentMetrics.find(m => m.agentId === input.agentId);
    if (!agentMetric) return fail("AGENT_NOT_FOUND", "Agent metrics not found");
    return ok(agentMetric);
  });

  registerHandle(IPC_CHANNELS.getStandupReport, (_event, payload) => {
    const companyId = companyIdSchema.parse(payload);
    const err = ensureCompanyExists(companyId);
    if (err) return err;
    return ok(db.getStandupReport(companyId));
  });

  registerHandle(IPC_CHANNELS.listCompanyTemplates, () => ok(COMPANY_TEMPLATES));

  registerHandle(IPC_CHANNELS.applyCompanyTemplate, (_event, payload) => {
    const input = templateApplySchema.parse(payload);
    const template = getTemplate(input.templateId);
    if (!template) return fail("TEMPLATE_NOT_FOUND", "Company template not found");

    const companyId = db.saveCompany({
      name: input.companyName,
      description: input.companyDescription || template.description,
      status: "active",
      autoApproveHires: true,
    });

    const agentIds: string[] = [];
    const connectors = db.listSnapshot().connectors;
    const readyConnectors = connectors.filter(c => c.status === "ready");
    const fallbackConnector = readyConnectors[0]?.id ?? input.connectorId ?? "claude_local";

    for (const agentDef of template.agents) {
      const connectorToUse = readyConnectors.find(c => c.id === agentDef.connectorPreference)
        ? agentDef.connectorPreference
        : fallbackConnector;

      const reportsTo = agentDef.reportsToIndex !== null ? agentIds[agentDef.reportsToIndex] ?? null : null;

      const agentId = db.saveAgent({
        companyId,
        name: agentDef.name,
        role: agentDef.role,
        title: agentDef.title,
        department: agentDef.department ?? null,
        capabilities: agentDef.capabilities,
        reportsTo,
        connectorId: connectorToUse,
        workspaceId: input.workspaceId ?? null,
        model: null,
        budgetMonthlyUsd: agentDef.budgetMonthlyUsd,
        status: "active",
      });
      agentIds.push(agentId);
    }

    const ceoId = agentIds[0];
    for (const goalDef of template.goals) {
      db.saveGoal({
        companyId,
        title: goalDef.title,
        description: goalDef.description,
        ownerAgentId: ceoId ?? null,
        parentId: null,
        status: "active",
      });
    }

    db.setCurrentCompany(companyId);

    if (ceoId) {
      db.setHeartbeat(ceoId, true, 60);
    }

    db.addActivity({
      companyId,
      actor: "board",
      action: "company.created_from_template",
      entityType: "company",
      entityId: companyId,
      detail: `Created from template: ${template.name}`,
    });

    const defaultRules: Array<{ name: string; description: string; trigger: string; action: string; conditionsJson?: string; actionConfigJson?: string; priority?: number }> = [
      {
        name: "Auto-assign new tasks",
        description: "Automatically assign new unassigned tasks to the best-fit agent based on capabilities and workload.",
        trigger: "task_created",
        action: "assign_task",
        priority: 90,
      },
      {
        name: "Escalate blocked tasks",
        description: "When a task is blocked, escalate to the assignee's manager.",
        trigger: "task_blocked",
        action: "escalate_to_manager",
        actionConfigJson: JSON.stringify({ body: "A task assigned to your report is blocked and needs your attention." }),
        priority: 85,
      },
      {
        name: "Escalate completed work to manager",
        description: "When a run completes successfully, escalate to the assignee's manager so they review the work.",
        trigger: "run_completed",
        action: "escalate_to_manager",
        actionConfigJson: JSON.stringify({ body: "A task run has completed successfully. Please review the work and approve or send back for changes." }),
        priority: 80,
      },
      {
        name: "Reassign on run failure",
        description: "When a run fails, attempt to reassign the task to another capable agent.",
        trigger: "run_failed",
        action: "reassign_task",
        priority: 75,
      },
      {
        name: "Budget alert at 80%",
        description: "Send an alert when an agent reaches 80% of their monthly budget.",
        trigger: "budget_threshold",
        action: "send_message",
        actionConfigJson: JSON.stringify({ subject: "Budget warning", body: "Agent is approaching budget limit (80% utilized).", priority: "urgent" }),
        priority: 70,
      },
      {
        name: "Notify department on task completion",
        description: "When a run completes successfully, send a status update to the agent's department channel.",
        trigger: "run_completed",
        action: "send_message",
        actionConfigJson: JSON.stringify({ channel: "department", subject: "Task completed", body: "A task has been completed successfully. Check the task details for more information.", priority: "low" }),
        priority: 40,
      },
      {
        name: "Wake new hire on approval",
        description: "When a new agent hire is approved, immediately wake the new agent to start onboarding.",
        trigger: "hire_approved",
        action: "trigger_heartbeat",
        actionConfigJson: JSON.stringify({}),
        priority: 90,
      },
      {
        name: "Auto-run assigned tasks",
        description: "When a task transitions to 'todo' status, automatically wake the assigned agent to start working on it.",
        trigger: "task_status_changed",
        conditionsJson: JSON.stringify({ status: "todo" }),
        action: "run_task",
        actionConfigJson: JSON.stringify({}),
        priority: 65,
      },
      {
        name: "Notify company on sprint start",
        description: "When a sprint starts, notify the entire company.",
        trigger: "sprint_started",
        action: "send_message",
        actionConfigJson: JSON.stringify({ channel: "company", subject: "Sprint started", body: "A new sprint has begun. Check your assigned tasks and start execution.", priority: "normal" }),
        priority: 50,
      },
      {
        name: "Schedule retrospective on sprint end",
        description: "When a sprint ends, schedule a retrospective meeting.",
        trigger: "sprint_ended",
        action: "schedule_meeting",
        actionConfigJson: JSON.stringify({ meetingType: "retrospective", title: "Sprint Retrospective", durationMinutes: 45 }),
        priority: 55,
      },
      {
        name: "Create status report on schedule",
        description: "Periodically create a status report document for the company.",
        trigger: "schedule",
        action: "create_document",
        actionConfigJson: JSON.stringify({ documentType: "status_report", title: "Automated Status Report" }),
        priority: 30,
      },
      {
        name: "Auto-assign work to idle agents",
        description: "When an agent has been idle for 10+ minutes, automatically assign available unassigned tasks from the backlog.",
        trigger: "agent_idle",
        action: "assign_task",
        priority: 60,
      },
      {
        name: "Wake idle agents to check for work",
        description: "When an agent has no tasks and is idle, wake them so they can check for available work and coordinate with their team.",
        trigger: "agent_idle",
        action: "trigger_heartbeat",
        priority: 45,
      },
    ];
    for (const rule of defaultRules) {
      db.saveAutomationRule({
        companyId,
        name: rule.name,
        description: rule.description,
        trigger: rule.trigger,
        conditionsJson: rule.conditionsJson ?? "{}",
        action: rule.action,
        actionConfigJson: rule.actionConfigJson ?? "{}",
        priority: rule.priority ?? 50,
        status: "active",
      });
    }

    for (const agentId of agentIds) {
      if (agentId !== ceoId) {
        db.setHeartbeat(agentId, true, 120); // 2 min interval for non-CEO
      }
    }

    // Generate initial company messages so channels are populated from day one
    generateInitialCompanyMessages(companyId, template, agentIds);

    publishDomainChanged();

    return ok(companyId);
  });

  registerHandle(IPC_CHANNELS.saveSocialAccount, (_event, payload) => {
    const input = socialAccountInputSchema.parse(payload);
    const err = ensureCompanyExists(input.companyId);
    if (err) return err;
    const id = db.saveSocialAccount(input);
    publishDomainChanged();
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.deleteSocialAccount, (_event, payload) => {
    const input = deleteEntitySchema.parse(payload);
    const err = ensureCompanyExists(input.companyId);
    if (err) return err;
    db.deleteSocialAccount(input.id, input.companyId);
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.listBrowserActions, (_event, payload) => {
    const input = browserActionQuerySchema.parse(payload);
    const err = ensureCompanyExists(input.companyId);
    if (err) return err;
    return ok(db.listBrowserActions(input.companyId, {
      socialAccountId: input.socialAccountId,
      status: input.status,
      limit: input.limit,
    }));
  });

  registerHandle(IPC_CHANNELS.cancelBrowserAction, (_event, payload) => {
    const input = cancelRunSchema.parse(payload);
    db.updateBrowserAction(input.runId, { status: "cancelled" });
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.triggerBrowserLogin, async (_event, payload) => {
    const socialAccountId = z.string().uuid().parse(payload);
    if (!browserManager) {
      return fail("BROWSER_NOT_READY", "Browser manager not initialized");
    }

    const account = db.getSocialAccount(socialAccountId, db.getCurrentCompanyId() ?? randomFallbackCompanyId());
    if (!account) {
      return fail("ACCOUNT_NOT_FOUND", "Social account not found");
    }

    browserManager.launchLoginBrowser(socialAccountId, account.platform).then(result => {
      if (result.success) {
        const latestAccount = db.getSocialAccount(socialAccountId, account.companyId);
        if (!latestAccount) {
          return;
        }
        db.saveSocialAccount({
          id: latestAccount.id,
          companyId: latestAccount.companyId,
          platform: latestAccount.platform,
          accountName: latestAccount.accountName,
          displayName: latestAccount.displayName,
          profileUrl: latestAccount.profileUrl,
          credentialSecretId: latestAccount.credentialSecretId,
          status: "logged_in",
          requireApproval: latestAccount.requireApproval,
        });
        publishDomainChanged();
      }
    }).catch(err => {
      log.error(`[browser] Login failed: ${err}`);
    });

    return ok(true);
  });

  registerHandle(IPC_CHANNELS.saveMeeting, async (_event, payload) => {
    const parsed = meetingInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const id = db.saveMeeting(parsed);
    publishDomainChanged();
    return ok(id);
  });

  const simpleDeleteHandlers: Array<{ channel: string; table: Parameters<typeof db.belongsToCompany>[0]; entity: string; deleteFn: (id: string, companyId: string) => void }> = [
    { channel: IPC_CHANNELS.deleteMeeting, table: "meetings", entity: "meeting", deleteFn: (id, cid) => db.deleteMeeting(id, cid) },
    { channel: IPC_CHANNELS.deleteDocument, table: "documents", entity: "document", deleteFn: (id, cid) => db.deleteDocument(id, cid) },
    { channel: IPC_CHANNELS.deleteKnowledgeEntry, table: "knowledge_base", entity: "knowledge entry", deleteFn: (id, cid) => db.deleteKnowledgeEntry(id, cid) },
    { channel: IPC_CHANNELS.deleteSprint, table: "sprints", entity: "sprint", deleteFn: (id, cid) => db.deleteSprint(id, cid) },
    { channel: IPC_CHANNELS.deleteAutomationRule, table: "automation_rules", entity: "automation rule", deleteFn: (id, cid) => db.deleteAutomationRule(id, cid) },
    { channel: IPC_CHANNELS.deleteWorkflow, table: "workflow_pipelines", entity: "workflow", deleteFn: (id, cid) => db.deleteWorkflow(id, cid) },
  ];
  for (const { channel, table, entity, deleteFn } of simpleDeleteHandlers) {
    registerHandle(channel, async (_event, payload) => {
      const parsed = deleteEntitySchema.parse(payload);
      const companyError = ensureCompanyExists(parsed.companyId);
      if (companyError) return companyError;
      if (!db.belongsToCompany(table, parsed.id, parsed.companyId)) {
        return fail("ENTITY_NOT_FOUND", `${entity.charAt(0).toUpperCase() + entity.slice(1)} not found in the current company.`);
      }
      deleteFn(parsed.id, parsed.companyId);
      publishDomainChanged();
      return ok(true);
    });
  }

  registerHandle(IPC_CHANNELS.saveDocument, async (_event, payload) => {
    const parsed = documentInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const isNew = !parsed.id;
    const id = db.saveDocument(parsed);
    if (isNew) {
      dispatchAutomation("document_created", {
        companyId: parsed.companyId,
        agentId: parsed.authorAgentId ?? undefined,
        projectId: parsed.projectId ?? undefined,
      });
      // Wake document reviewer if specified
      if (parsed.authorAgentId && parsed.reviewerAgentId) {
        wakeAgentIfPossible(parsed.reviewerAgentId, parsed.companyId, "assignment");
      }
    }
    publishDomainChanged();
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.saveKnowledgeEntry, async (_event, payload) => {
    const parsed = knowledgeEntryInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const id = db.saveKnowledgeEntry(parsed);
    publishDomainChanged();
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.saveSprint, async (_event, payload) => {
    const parsed = sprintInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    let previousSprintStatus: string | null = null;
    if (parsed.id) {
      try {
        const existing = db.listSnapshot().sprints.find(s => s.id === parsed.id);
        previousSprintStatus = existing?.status ?? null;
      } catch { /* sprint is new */ }
    }
    const id = db.saveSprint(parsed);
    // Fire sprint_started when transitioning to active (not just on new sprints)
    if (parsed.status === "active" && previousSprintStatus !== "active") {
      dispatchAutomation("sprint_started", { companyId: parsed.companyId });
    }
    // Fire sprint_ended when transitioning to completed
    if (parsed.status === "completed" && previousSprintStatus !== "completed") {
      dispatchAutomation("sprint_ended", { companyId: parsed.companyId });
    }
    publishDomainChanged();
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.saveAutomationRule, async (_event, payload) => {
    const parsed = automationRuleInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const id = db.saveAutomationRule(parsed);
    publishDomainChanged();
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.toggleAutomationRule, async (_event, payload) => {
    const parsed = toggleAutomationRuleSchema.parse(payload);
    db.toggleAutomationRule(parsed.id, parsed.companyId, parsed.status);
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.getAutomationLog, async (_event, companyId) => {
    const parsed = companyIdSchema.parse(companyId);
    return ok(db.getAutomationLog(parsed));
  });

  registerHandle(IPC_CHANNELS.sendAgentMessage, async (_event, payload) => {
    const parsed = agentMessageInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (parsed.channel === "direct" && !parsed.toAgentId) {
      return fail("DIRECT_MESSAGE_RECIPIENT_REQUIRED", "Direct messages require a recipient agent.");
    }
    const invalidReference = findInvalidReference(parsed.companyId, [
      { id: parsed.toAgentId, table: "agents", label: "message recipient" },
      { id: parsed.channel === "project" ? parsed.channelTargetId : null, table: "projects", label: "project channel" },
    ]);
    if (invalidReference) {
      return fail("INVALID_COMPANY_REFERENCE", `The selected ${invalidReference.label} does not belong to the current company.`);
    }
    const id = db.sendAgentMessage(parsed);
    const msg = db.listAgentMessages(parsed.companyId, { limit: 1 })?.[0];
    if (msg) emitEvent({ type: "new-message", message: msg });
    publishDomainChanged();
    // Wake the recipient agent so they can respond
    if (parsed.toAgentId) {
      wakeAgentIfPossible(parsed.toAgentId, parsed.companyId, "message");
    }
    // For department messages, wake agents in the department
    if (parsed.channel === "department" && parsed.channelTargetId) {
      const deptAgents = db.getIdleAgentsForDepartment(parsed.companyId, parsed.channelTargetId);
      for (const agent of deptAgents.filter((a) => a.id !== parsed.fromAgentId).slice(0, 3)) {
        wakeAgentIfPossible(agent.id, parsed.companyId, "message");
      }
    }
    // For company-wide messages, wake the CEO so leadership responds
    if (parsed.channel === "company") {
      const snapshot = db.listSnapshot();
      const ceo = snapshot.agents.find((a) => a.companyId === parsed.companyId && !a.reportsTo && a.status !== "terminated");
      if (ceo && ceo.id !== parsed.fromAgentId) {
        wakeAgentIfPossible(ceo.id, parsed.companyId, "message");
      }
    }
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.listAgentMessages, async (_event, payload) => {
    const parsed = messageQuerySchema.parse(payload);
    return ok(db.listAgentMessages(parsed.companyId, {
      agentId: parsed.agentId,
      channel: parsed.channel,
      channelTargetId: parsed.channelTargetId,
      unreadOnly: parsed.unreadOnly,
      limit: parsed.limit,
    }));
  });

  registerHandle(IPC_CHANNELS.markMessageRead, async (_event, payload) => {
    const parsed = markMessageReadSchema.parse(payload);
    db.markMessageRead(parsed.messageId, parsed.companyId);
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.saveWorkflow, async (_event, payload) => {
    const parsed = workflowInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const id = db.saveWorkflow(parsed);
    publishDomainChanged();
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.runWorkflow, async (_event, payload) => {
    const parsed = runWorkflowSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    await runWorkflowPipeline(parsed.id, parsed.companyId);
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.autoAssignTask, async (_event, payload) => {
    const parsed = autoAssignSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const agentId = db.autoAssignTask(parsed.taskId, parsed.companyId);
    if (!agentId) return fail("NO_AVAILABLE_AGENT", "No available agent could be found for this task.");
    publishDomainChanged();
    return ok(agentId);
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

  // Resolve additional PATH entries from the user's login shell
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
    } catch { /* non-fatal */ }
  }

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
  createTray();
  createWorker();
  registerHandlers();

  apiServer = new AgentApiServer(db, publishDomainChanged, (agentId, companyId, trigger) => {
    return wakeAgentIfPossible(agentId, companyId, trigger);
  }, {
    onDomainChanged: publishDomainChanged,
    onWakeAgent: (agentId, companyId, trigger) => wakeAgentIfPossible(agentId, companyId, trigger),
    onTaskCreated: (taskId, companyId) => handleTaskCreated(taskId, companyId),
    onTaskStatusChanged: (taskId, companyId, prev, next) => handleTaskStatusChange(taskId, companyId, prev, next),
    onCommentPosted: (taskId, companyId, authorAgentId) => {
      dispatchAutomation("comment_posted", { companyId, taskId, agentId: authorAgentId ?? undefined });
    },
    onApprovalResolved: (approvalId, companyId, decision) => handleApprovalResolved(approvalId, companyId, decision),
    onDocumentCreated: (companyId, authorAgentId, projectId) => {
      dispatchAutomation("document_created", { companyId, agentId: authorAgentId ?? undefined, projectId: projectId ?? undefined });
    },
    onAutoAssignTask: (taskId, companyId) => db.autoAssignTask(taskId, companyId),
  });
  await apiServer.start();

  browserManager = new BrowserManager(join(app.getPath("userData"), "browser-data"));

  if (apiServer && browserManager) {
    apiServer.setBrowserActionHandler(async (actionId, companyId, socialAccountId, actionType, payload) => {
      void socialAccountId;
      void actionType;
      void payload;
      await dispatchBrowserAction(actionId, companyId);
    });
  }

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

app.on("window-all-closed", () => {});

app.on("before-quit", () => {
  isQuitting = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  apiServer?.stop();
  apiServer = null;
  browserManager?.shutdown();
  browserManager = null;
  appTray?.destroy();
  appTray = null;
  worker?.kill();
  worker = null;
  db?.close();
});

if (hasSingleInstanceLock) {
  void bootstrap();
} else {
  app.quit();
}
