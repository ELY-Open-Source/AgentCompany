import { app } from "electron";
import type { AgentApiServer } from "./api-server";
import type { AppDatabase } from "./database";
import { BrowserManager } from "./browser-manager";
import { createAutomationService } from "./automation-service";
import { createBrowserActionService } from "./browser-action-service";
import { createConnectorHealthService } from "./connector-health-service";
import { createDesktopShellService } from "./desktop-shell-service";
import { createOnboardingService } from "./onboarding-service";
import { createOrchestrationService } from "./orchestration-service";
import { createUpdaterService } from "./updater-service";
import { createWorkerService } from "./worker-service";
import { createAppLifecycleService } from "./app-lifecycle-service";
import type { DesktopEvent, RunRecord } from "@shared/types";
import type { AutomationEventContext } from "./automation-service";
import type { NotificationOptions } from "./notification-service";

interface ServiceGraphDependencies {
  db: AppDatabase;
  apiServerRef: { current: AgentApiServer | null };
  browserManagerRef: { current: BrowserManager | null };
  isQuittingRef: { current: boolean };
  preloadPath: string;
  rendererDist: string;
  iconPath: string;
  isDev: boolean;
  devServerUrl?: string;
  windowStatePath: string;
  workerPath: string;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  emitEvent: (event: DesktopEvent) => void;
  publishDomainChanged: () => void;
  notify: (options: NotificationOptions) => void;
  createRunToken: (agentId: string, companyId: string, runId: string) => string;
  seedDefaultAutomationRules: (companyId: string) => void;
}

export function createServiceGraph({
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
  logger,
  emitEvent,
  publishDomainChanged,
  notify,
  createRunToken,
  seedDefaultAutomationRules,
}: ServiceGraphDependencies) {
  let automationService: ReturnType<typeof createAutomationService> | null = null;
  let browserActionService: ReturnType<typeof createBrowserActionService> | null = null;
  let connectorHealthService: ReturnType<typeof createConnectorHealthService> | null = null;
  let onboardingService: ReturnType<typeof createOnboardingService> | null = null;
  let desktopShellService: ReturnType<typeof createDesktopShellService> | null = null;
  let orchestrationService: ReturnType<typeof createOrchestrationService> | null = null;
  let workerService: ReturnType<typeof createWorkerService> | null = null;
  let updaterService: ReturnType<typeof createUpdaterService> | null = null;
  let appLifecycleService: ReturnType<typeof createAppLifecycleService> | null = null;

  const wakeAgentIfPossible = (agentId: string | null | undefined, companyId: string, trigger: string) => {
    if (!orchestrationService) {
      throw new Error("Orchestration service is not initialized.");
    }
    return orchestrationService.wakeAgentIfPossible(agentId, companyId, trigger);
  };

  const dispatchBrowserAction = async (actionId: string, companyId: string) => {
    if (!browserActionService) {
      throw new Error("Browser action service is not initialized");
    }
    return browserActionService.dispatchBrowserAction(actionId, companyId);
  };

  const dispatchAutomation = (trigger: string, ctx: AutomationEventContext) => {
    if (!automationService) {
      throw new Error("Automation service is not initialized.");
    }
    automationService.dispatchAutomation(trigger, ctx);
  };

  const processRunCompletion = (run: RunRecord, event: Parameters<ReturnType<typeof createAutomationService>["processRunCompletion"]>[1]) => {
    if (!automationService) {
      throw new Error("Automation service is not initialized.");
    }
    automationService.processRunCompletion(run, event);
  };

  const queueTaskRun = (taskId: string, trigger: string, actor: string) => {
    if (!orchestrationService) {
      throw new Error("Orchestration service is not initialized.");
    }
    return orchestrationService.queueTaskRun(taskId, trigger, actor);
  };

  const dispatchRunToWorker = (params: Parameters<ReturnType<typeof createOrchestrationService>["dispatchRunToWorker"]>[0]) => {
    if (!orchestrationService) {
      throw new Error("Orchestration service is not initialized.");
    }
    return orchestrationService.dispatchRunToWorker(params);
  };

  function init() {
    desktopShellService = createDesktopShellService({
      preloadPath,
      rendererDist,
      iconPath,
      isDev,
      devServerUrl,
      windowStatePath,
      shouldQuit: () => isQuittingRef.current,
      onRequestQuit: () => {
        isQuittingRef.current = true;
      },
      onCheckForUpdates: async () => {
        if (!updaterService) throw new Error("Updater service is not initialized.");
        await updaterService.checkForUpdates();
      },
      onBackupProfile: async () => {
        const target = await import("electron").then(({ dialog }) => dialog.showOpenDialog({
          properties: ["openDirectory", "createDirectory"],
        }));
        if (target.canceled || target.filePaths.length === 0) return;
        await db.exportBackup(`${target.filePaths[0]!}/agentcompany-backup-${Date.now()}`);
      },
      onShortcut: (action) => emitEvent({ type: "shortcut", action }),
      notify,
      getActiveRunCount: () => {
        try {
          const snapshot = db.listSnapshot();
          return snapshot.runs.filter((r) => r.status === "running" || r.status === "queued").length;
        } catch {
          return 0;
        }
      },
    });
    desktopShellService.initialize();

    connectorHealthService = createConnectorHealthService({
      db,
      logger,
      publishDomainChanged,
    });

    workerService = createWorkerService({
      db,
      logger,
      workerPath,
      isQuitting: () => isQuittingRef.current,
      publishDomainChanged,
      emitEvent,
      wakeAgentIfPossible,
      dispatchRunToWorker,
      processRunCompletion: (run, event) => processRunCompletion(run, event),
      notify,
    });

    orchestrationService = createOrchestrationService({
      db,
      logger,
      publishDomainChanged,
      notify,
      createRunToken,
      getApiPort: () => apiServerRef.current?.getPort() ?? 0,
      dispatchAutomation,
      hasWorkerReady: () => Boolean(workerService?.getWorker()),
      enqueueWorkerRun: (payload) => {
        workerService?.getWorker()?.postMessage({ type: "enqueue-run", payload });
      },
      isQuitting: () => isQuittingRef.current,
    });
    workerService.createWorker();

    automationService = createAutomationService({
      db,
      logger,
      emitEvent,
      publishDomainChanged,
      notify,
      wakeAgentIfPossible,
      dispatchBrowserAction,
      isQuitting: () => isQuittingRef.current,
    });

    onboardingService = createOnboardingService({
      db,
      seedDefaultAutomationRules,
      queueTaskRun,
      publishDomainChanged,
    });

    browserActionService = createBrowserActionService({
      db,
      browserManagerRef,
      publishDomainChanged,
    });
    browserActionService.resetBrowserManager();

    updaterService = createUpdaterService({
      db,
      logger,
      notify,
    });
    updaterService.attachListeners();

    appLifecycleService = createAppLifecycleService({
      getMainWindow: () => desktopShellService?.getMainWindow() ?? null,
      ensureWindow: async () => desktopShellService?.ensureWindow() ?? null,
      shouldQuit: () => isQuittingRef.current,
      onBeforeQuit: () => {
        isQuittingRef.current = true;
        orchestrationService?.stopHeartbeatScheduler();
        automationService?.destroy();
        apiServerRef.current?.stop();
        apiServerRef.current = null;
        browserManagerRef.current?.shutdown();
        browserManagerRef.current = null;
        desktopShellService?.destroy();
        desktopShellService = null;
        workerService?.destroy();
        workerService = null;
        browserActionService = null;
        automationService = null;
        connectorHealthService = null;
        onboardingService = null;
        orchestrationService = null;
        updaterService = null;
        appLifecycleService = null;
        db.close();
        // Force exit after grace period — covers all platforms (macOS Dock, Windows tray, Linux)
        // Worker child processes (claude/codex CLI) may keep the event loop alive indefinitely
        setTimeout(() => { app.exit(0); }, 3000);
      },
    });
  }

  return {
    init,
    getDesktopShellService: () => desktopShellService,
    getConnectorHealthService: () => connectorHealthService,
    getWorkerService: () => workerService,
    getBrowserActionService: () => browserActionService,
    getOrchestrationService: () => orchestrationService,
    getAutomationService: () => automationService,
    getOnboardingService: () => onboardingService,
    getUpdaterService: () => updaterService,
    getAppLifecycleService: () => appLifecycleService,
  };
}
