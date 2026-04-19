import { app } from "electron";
import type { AgentApiServer } from "./api-server";
import type { AppDatabase } from "./database";
import type { BrowserManager } from "./browser-manager";
import { prepareHostEnvironment } from "./host-environment-service";
import type { createServiceGraph } from "./service-graph";
import type { createIpcSupport } from "./ipc-support";
import type { createThreadIntegration } from "./thread-integration";
import type { createCheckpointEngine } from "./checkpoint-engine";
import {
  DocumentLifecycleProcessor,
  makeLifecycleProcessorOptions,
} from "./document-lifecycle-processor";
import { registerLifecycleHandlers } from "./document-lifecycle-handlers";
import { prepareLogger } from "./bootstrap/prepare-logger";
import { prepareDatabase } from "./bootstrap/prepare-database";
import { prepareServices } from "./bootstrap/prepare-services";
import { wireApiServer, type CreateApiServerFn } from "./bootstrap/wire-api-server";
import { recoverScheduledPosts } from "./bootstrap/recover-scheduled-posts";
import { runStartupHealthChecks } from "./bootstrap/run-startup-health-checks";
import { emitCrashRecoveryNotification, recoverShutdownInterruptedTasks } from "./bootstrap/recover-interrupted-tasks";

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
  createApiServer: CreateApiServerFn;
  createRunToken: (agentId: string, companyId: string, runId: string) => string;
  seedDefaultAutomationRules: (companyId: string) => void;
  isQuittingRef: { current: boolean };
  onRuntimeReady?: (state: {
    db: AppDatabase;
    apiServer: AgentApiServer;
    serviceGraph: ReturnType<typeof createServiceGraph>;
    ipcSupport: ReturnType<typeof createIpcSupport>;
    threadIntegration: ReturnType<typeof createThreadIntegration>;
    checkpointEngine: ReturnType<typeof createCheckpointEngine>;
    lifecycleProcessor: DocumentLifecycleProcessor;
  }) => void;
}

export async function bootstrapApplication(deps: BootstrapApplicationDependencies) {
  await app.whenReady();
  const log = prepareLogger();

  await prepareHostEnvironment({ logger: log });

  const db = prepareDatabase({
    profileDir: deps.profileDir,
    appDatabaseFactory: deps.appDatabaseFactory,
    initSigningKey: deps.initSigningKey,
  });

  const apiServerRef = { current: null as AgentApiServer | null };
  const browserManagerRef = { current: null as BrowserManager | null };

  const services = prepareServices({
    db,
    apiServerRef,
    browserManagerRef,
    isQuittingRef: deps.isQuittingRef,
    preloadPath: deps.preloadPath,
    rendererDist: deps.rendererDist,
    iconPath: deps.iconPath,
    isDev: deps.isDev,
    devServerUrl: deps.devServerUrl,
    devServerOrigin: deps.devServerOrigin,
    windowStatePath: deps.windowStatePath,
    workerPath: deps.workerPath,
    logger: log,
    createRunToken: deps.createRunToken,
    seedDefaultAutomationRules: deps.seedDefaultAutomationRules,
  });
  const { serviceGraph, ipcSupport, threadIntegration, notificationService, checkpointEngine, notify, emitEvent, publishDomainChanged } = services;

  const wakeAgentIfPossible = (agentId: string | null | undefined, companyId: string, trigger: string) => {
    const orchestration = serviceGraph.getOrchestrationService();
    if (!orchestration) throw new Error("Orchestration service is not initialized.");
    return orchestration.wakeAgentIfPossible(agentId, companyId, trigger);
  };

  const lifecycleProcessor = new DocumentLifecycleProcessor(
    makeLifecycleProcessorOptions({ db, logger: log }),
  );
  registerLifecycleHandlers(lifecycleProcessor, {
    dispatchAutomation: (trigger, ctx) => {
      const automation = serviceGraph.getAutomationService();
      if (!automation) throw new Error("Automation service is not initialized.");
      automation.dispatchAutomation(trigger, ctx);
    },
    wakeAgentIfPossible,
  });

  const apiServer = wireApiServer({
    db,
    serviceGraph,
    threadIntegration,
    checkpointEngine,
    lifecycleProcessor,
    emitEvent,
    notify,
    publishDomainChanged,
    isDev: deps.isDev,
    devServerUrl: deps.devServerUrl,
    createApiServer: deps.createApiServer,
  });

  apiServerRef.current = apiServer;
  await apiServer.start();
  deps.onRuntimeReady?.({
    db,
    apiServer,
    serviceGraph,
    ipcSupport,
    threadIntegration,
    checkpointEngine,
    lifecycleProcessor,
  });

  lifecycleProcessor.start();
  app.on("before-quit", () => lifecycleProcessor.stop());

  if (apiServer && serviceGraph.getBrowserActionService()) {
    apiServer.setBrowserActionHandler(async (actionId, companyId) => {
      const browserActions = serviceGraph.getBrowserActionService();
      if (!browserActions) throw new Error("Browser action service is not initialized");
      await browserActions.dispatchBrowserAction(actionId, companyId);
    });
  }

  const scheduledPostTimers = recoverScheduledPosts({
    db,
    logger: log,
    isQuittingRef: deps.isQuittingRef,
    getBrowserActionService: () => serviceGraph.getBrowserActionService(),
  });

  // Register cleanup for bootstrap-owned resources during quit.
  // Runs BEFORE service-graph's onBeforeQuit (which is registered later).
  app.on("before-quit", () => {
    for (const timer of scheduledPostTimers) clearTimeout(timer);
    scheduledPostTimers.clear();
    notificationService.destroy();
  });

  // Show the window immediately so the user sees the app launch without delay.
  await serviceGraph.getDesktopShellService()?.ensureWindow();
  serviceGraph.getAppLifecycleService()?.register(deps.hasSingleInstanceLock);

  // Run connector health checks AFTER the window is visible to unblock startup.
  await runStartupHealthChecks(db, serviceGraph.getConnectorHealthService(), log);

  serviceGraph.getOrchestrationService()?.startAllSchedulers();

  emitCrashRecoveryNotification({
    db,
    logger: log,
    emitEvent,
    notify,
    publishDomainChanged,
    wakeAgentIfPossible,
  });

  serviceGraph.getOrchestrationService()?.resumeQueuedRuns();

  recoverShutdownInterruptedTasks({
    db,
    logger: log,
    emitEvent,
    notify,
    publishDomainChanged,
    wakeAgentIfPossible,
  });

  return { db, apiServer, serviceGraph, ipcSupport, threadIntegration };
}
