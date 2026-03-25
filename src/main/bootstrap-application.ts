import { app } from "electron";
import log from "electron-log/main.js";
import type { AgentApiServer } from "./api-server";
import type { AppDatabase } from "./database";
import type { BrowserManager } from "./browser-manager";
import { prepareHostEnvironment } from "./host-environment-service";
import { createServiceGraph } from "./service-graph";
import { createIpcSupport } from "./ipc-support";
import { createNotificationService } from "./notification-service";
import type { NotificationOptions } from "./notification-service";
import type { DesktopEvent, SectionId } from "@shared/types";

interface BootstrapApplicationDependencies {
  hasSingleInstanceLock: boolean;
  isDev: boolean;
  devServerOrigin: string | null;
  profileDir: string;
  appDatabaseFactory: (profileDir: string) => AppDatabase;
  initSigningKey: (profileDir: string) => void;
  windowStatePath: string;
  preloadPath: string;
  rendererDist: string;
  iconPath: string;
  devServerUrl?: string;
  workerPath: string;
  createApiServer: (db: AppDatabase, callbacks: {
    onDomainChanged: () => void;
    onWakeAgent: (agentId: string, companyId: string, trigger: string) => string | null;
    onTaskCreated: (taskId: string, companyId: string) => void;
    onTaskStatusChanged: (taskId: string, companyId: string, prev: string, next: string) => void;
    onCommentPosted: (taskId: string, companyId: string, authorAgentId: string | null) => void;
    onApprovalResolved: (approvalId: string, companyId: string, decision: string) => void;
    onDocumentCreated: (companyId: string, authorAgentId: string | null, projectId: string | null) => void;
    onAutoAssignTask: (taskId: string, companyId: string) => string | null;
    emitEvent: (event: DesktopEvent) => void;
    notify: (options: { title: string; body: string; urgency: "critical" | "informational"; navigation?: { section: SectionId; entityId?: string }; batchKey?: string }) => void;
  }, allowedOrigins: string[]) => AgentApiServer;
  createRunToken: (agentId: string, companyId: string, runId: string) => string;
  seedDefaultAutomationRules: (companyId: string) => void;
  isQuittingRef: { current: boolean };
  onRuntimeReady?: (state: {
    db: AppDatabase;
    apiServer: AgentApiServer;
    serviceGraph: ReturnType<typeof createServiceGraph>;
    ipcSupport: ReturnType<typeof createIpcSupport>;
  }) => void;
}

export async function bootstrapApplication({
  hasSingleInstanceLock,
  isDev,
  devServerOrigin,
  profileDir,
  appDatabaseFactory,
  initSigningKey,
  windowStatePath,
  preloadPath,
  rendererDist,
  iconPath,
  devServerUrl,
  workerPath,
  createApiServer,
  createRunToken,
  seedDefaultAutomationRules,
  isQuittingRef,
  onRuntimeReady,
}: BootstrapApplicationDependencies) {
  await app.whenReady();
  log.initialize();
  await prepareHostEnvironment({ iconPath, logger: log });

  const db = appDatabaseFactory(profileDir);
  db.init();
  initSigningKey(db.profileDir);

  const apiServerRef = { current: null as AgentApiServer | null };
  const browserManagerRef = { current: null as BrowserManager | null };
  let ipcSupport: ReturnType<typeof createIpcSupport> | null = null;
  let serviceGraph: ReturnType<typeof createServiceGraph> | null = null;

  const notificationService = createNotificationService({
    getMainWindow: () => serviceGraph?.getDesktopShellService()?.getMainWindow() ?? null,
    emitEvent: (event: DesktopEvent) => ipcSupport?.emitEvent(event),
    logger: log,
  });

  const notify = (options: NotificationOptions) => {
    if (!ipcSupport) {
      throw new Error("IPC support is not initialized.");
    }
    ipcSupport.notify(options);
  };
  const emitEvent = (event: DesktopEvent) => {
    ipcSupport?.emitEvent(event);
  };
  const publishDomainChanged = () => {
    ipcSupport?.publishDomainChanged();
  };

  serviceGraph = createServiceGraph({
    db,
    apiServerRef,
    browserManagerRef,
    isQuittingRef,
    preloadPath,
    rendererDist,
    iconPath,
    isDev,
    devServerUrl,
    windowStatePath,
    workerPath,
    logger: log,
    emitEvent,
    publishDomainChanged,
    notify,
    createRunToken,
    seedDefaultAutomationRules,
  });
  ipcSupport = createIpcSupport({
    isDev,
    devServerOrigin,
    logger: log,
    getMainWindow: () => serviceGraph?.getDesktopShellService()?.getMainWindow() ?? null,
    getDb: () => ({
      hasCompany: (companyId: string) => db.hasCompany(companyId),
      belongsToCompany: (table: string, id: string, companyId: string) => db.belongsToCompany(table as any, id, companyId),
    }),
    notificationService,
  });
  serviceGraph.init();

  const wakeAgentIfPossible = (agentId: string | null | undefined, companyId: string, trigger: string) => {
    const orchestration = serviceGraph.getOrchestrationService();
    if (!orchestration) throw new Error("Orchestration service is not initialized.");
    return orchestration.wakeAgentIfPossible(agentId, companyId, trigger);
  };
  const handleTaskCreated = (taskId: string, companyId: string) => {
    const automation = serviceGraph.getAutomationService();
    if (!automation) throw new Error("Automation service is not initialized.");
    automation.handleTaskCreated(taskId, companyId);
  };
  const handleTaskStatusChange = (taskId: string, companyId: string, prev: string, next: string) => {
    const automation = serviceGraph.getAutomationService();
    if (!automation) throw new Error("Automation service is not initialized.");
    automation.handleTaskStatusChange(taskId, companyId, prev, next);
  };
  const handleApprovalResolved = (approvalId: string, companyId: string, decision: string) => {
    const automation = serviceGraph.getAutomationService();
    if (!automation) throw new Error("Automation service is not initialized.");
    automation.handleApprovalResolved(approvalId, companyId, decision);
  };
  const dispatchAutomation = (trigger: string, ctx: Record<string, unknown>) => {
    const automation = serviceGraph.getAutomationService();
    if (!automation) throw new Error("Automation service is not initialized.");
    automation.dispatchAutomation(trigger, ctx as any);
  };

  const apiServer = createApiServer(db, {
    onDomainChanged: publishDomainChanged,
    onWakeAgent: (agentId, companyId, trigger) => wakeAgentIfPossible(agentId, companyId, trigger),
    onTaskCreated: handleTaskCreated,
    onTaskStatusChanged: handleTaskStatusChange,
    onCommentPosted: (taskId, companyId, authorAgentId) => {
      dispatchAutomation("comment_posted", { companyId, taskId, agentId: authorAgentId ?? undefined });
    },
    onApprovalResolved: handleApprovalResolved,
    onDocumentCreated: (companyId, authorAgentId, projectId) => {
      dispatchAutomation("document_created", { companyId, agentId: authorAgentId ?? undefined, projectId: projectId ?? undefined });
    },
    onAutoAssignTask: (taskId, companyId) => db.autoAssignTask(taskId, companyId),
    emitEvent,
    notify,
  }, [isDev && devServerUrl ? new URL(devServerUrl).origin : null, "app://-"].filter((origin): origin is string => Boolean(origin)));

  apiServerRef.current = apiServer;
  await apiServer.start();
  onRuntimeReady?.({
    db,
    apiServer,
    serviceGraph,
    ipcSupport,
  });

  if (apiServer && serviceGraph.getBrowserActionService()) {
    apiServer.setBrowserActionHandler(async (actionId, companyId) => {
      const browserActions = serviceGraph.getBrowserActionService();
      if (!browserActions) throw new Error("Browser action service is not initialized");
      await browserActions.dispatchBrowserAction(actionId, companyId);
    });
  }

  // Re-register timers for scheduled social posts (survives app restart).
  // Scan all companies for queued browser actions with a future scheduledAt time
  // and set up setTimeout to dispatch them at the right moment.
  const scheduledPostTimers = new Set<ReturnType<typeof setTimeout>>();
  try {
    const snapshot = db.listSnapshot();
    for (const company of snapshot.companies) {
      const queuedActions = db.listBrowserActions(company.id, { status: "queued" });
      for (const action of queuedActions) {
        if (action.payloadJson) {
          try {
            const payload = JSON.parse(action.payloadJson) as { scheduledAt?: string };
            if (payload.scheduledAt) {
              const delay = new Date(payload.scheduledAt).getTime() - Date.now();
              if (delay > 0) {
                const timer = setTimeout(() => {
                  scheduledPostTimers.delete(timer);
                  if (isQuittingRef.current) return;
                  const browserActions = serviceGraph?.getBrowserActionService();
                  if (browserActions) {
                    void browserActions.dispatchBrowserAction(action.id, company.id);
                  }
                }, delay);
                scheduledPostTimers.add(timer);
                log.info(`[bootstrap] Re-registered scheduled post timer: action ${action.id} in ${Math.round(delay / 1000)}s`);
              }
              // If delay <= 0, the action is overdue -- normal dispatch cycle will pick it up
            }
          } catch { /* ignore malformed payload */ }
        }
      }
    }
  } catch (error) {
    log.warn(`[bootstrap] Failed to re-register scheduled post timers: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Register cleanup for bootstrap-owned resources during quit.
  // This runs BEFORE service-graph's onBeforeQuit (which is registered later).
  app.on("before-quit", () => {
    for (const timer of scheduledPostTimers) {
      clearTimeout(timer);
    }
    scheduledPostTimers.clear();
    notificationService.destroy();
  });

  // Show the window immediately so the user sees the app launch without delay.
  await serviceGraph.getDesktopShellService()?.ensureWindow();
  serviceGraph.getAppLifecycleService()?.register(hasSingleInstanceLock);

  // Run connector health checks AFTER the window is visible.
  // This ensures connectors have a known status before any agent run is attempted,
  // but doesn't block the startup experience.
  const connectorHealth = serviceGraph.getConnectorHealthService();
  if (connectorHealth) {
    const connectors = db.listSnapshot().connectors;
    const healthCheckResults = await Promise.allSettled(
      connectors.map((connector) => connectorHealth.checkConnector(connector.id)),
    );
    for (let i = 0; i < healthCheckResults.length; i++) {
      const result = healthCheckResults[i]!;
      if (result.status === "rejected") {
        log.warn(`[bootstrap] Connector health check failed for ${connectors[i]?.id}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      }
    }
    log.info(`[bootstrap] Connector health checks completed (${healthCheckResults.filter((r) => r.status === "fulfilled").length}/${connectors.length} succeeded)`);
  }

  serviceGraph.getOrchestrationService()?.startHeartbeatScheduler();

  // Check for crash recovery -- emit recovery notification before resuming queued runs
  const interruptedCount = db.lastInterruptedCount;
  if (interruptedCount > 0) {
    log.warn(`[bootstrap] Detected ${interruptedCount} interrupted runs from previous session. Sending recovery notification.`);
    const interruptedRuns = db.getInterruptedRunsForRecovery();
    if (interruptedRuns.length > 0) {
      emitEvent({
        type: "recovery-needed",
        interruptedRuns,
      } as any); // DesktopEvent will need extending
      notify({
        title: "Session Recovered",
        body: `${interruptedRuns.length} interrupted task(s) detected from previous session`,
        urgency: "informational",
        navigation: { section: "overview" },
      });
    }
  }

  serviceGraph.getOrchestrationService()?.resumeQueuedRuns();

  return {
    db,
    apiServer,
    serviceGraph,
    ipcSupport,
  };
}
