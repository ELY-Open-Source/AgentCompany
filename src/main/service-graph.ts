import { nativeTheme } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import type { AgentApiServer } from "./api-server";
import type { AppDatabase } from "./database";
import { BrowserManager } from "./browser-manager";
import type { DesktopResult } from "@shared/contracts";
import { createConnectorHealthService } from "./connector-health-service";
import { createPiRuntimeServices, type PiRuntimeServices } from "./service-graph-pi-runtime";
import { RuntimeMessageInjector } from "./agent-runtime";
import type { DesktopEvent } from "@shared/types";
import type { NotificationOptions } from "./notification-service";
import type { createAutomationService } from "./automation-service";
import type { createBrowserActionService } from "./browser-action-service";
import type { createOnboardingService } from "./onboarding-service";
import type { createOrchestrationService } from "./orchestration-service";
import { createUpdaterService } from "./updater-service";
import { createLeafServices } from "./service-graph/create-leaf-services";
import { createDesktopShell } from "./service-graph/create-desktop-shell";
import { buildWorkerService } from "./service-graph/create-worker-service";
import { buildOrchestrationService } from "./service-graph/create-orchestration-service";
import { createBackgroundServices } from "./service-graph/create-background-services";
import { createLifecycle } from "./service-graph/create-lifecycle";
import { createServiceEventHub } from "./service-graph/service-event-hub";

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
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  emitEvent: (event: DesktopEvent) => void;
  publishDomainChanged: () => void;
  notify: (options: NotificationOptions) => void;
  createRunToken: (agentId: string, companyId: string, runId: string) => string;
  seedDefaultAutomationRules: (companyId: string) => void;
  onRunStarted?: (runId: string, taskId: string | null, agentId: string, companyId: string) => void;
  onRunCompleted?: (runId: string, taskId: string | null, agentId: string, companyId: string, status: string, summary: string | null, errorMessage: string | null) => void;
  /** Checkpoint engine for unified co-founder mode pause decisions in scheduler. */
  checkpointEngine?: { shouldPauseHeartbeat: (companyId: string, agentId: string) => boolean };
  /** Trusted-sender IPC wrapper from createIpcSupport. Window-control channels use it. */
  registerHandle: (
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<DesktopResult<unknown>> | DesktopResult<unknown>,
  ) => void;
}

/**
 * Thin orchestrator: assembles services in a deterministic topological order
 * and exposes them via read-only getters. Cross-service callbacks are routed
 * through a typed event hub so construction order stays explicit.
 */
export function createServiceGraph(deps: ServiceGraphDependencies) {
  const {
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
    onRunStarted,
    onRunCompleted,
    checkpointEngine,
    registerHandle,
  } = deps;

  // Service slots owned by the graph. Null before init() completes and after
  // the lifecycle drain has torn services down.
  let desktopShellService: ReturnType<typeof createDesktopShell> | null = null;
  let connectorHealthService: ReturnType<typeof createConnectorHealthService> | null = null;
  let workerService: ReturnType<typeof buildWorkerService> | null = null;
  let orchestrationService: ReturnType<typeof createOrchestrationService> | null = null;
  let automationService: ReturnType<typeof createAutomationService> | null = null;
  let browserActionService: ReturnType<typeof createBrowserActionService> | null = null;
  let onboardingService: ReturnType<typeof createOnboardingService> | null = null;
  let updaterService: ReturnType<typeof createUpdaterService> | null = null;
  let appLifecycleService: ReturnType<typeof createLifecycle> | null = null;
  let leaf: ReturnType<typeof createLeafServices> | null = null;
  let runtimeMessageInjector: RuntimeMessageInjector | null = null;
  const piRuntimeRef: { current: PiRuntimeServices | null } = { current: null };
  const serviceEvents = createServiceEventHub();

  function requireLeaf() {
    if (!leaf) throw new Error("Leaf services are not initialized.");
    return leaf;
  }

  function init() {
    nativeTheme.themeSource = db.snap.listSnapshot().theme;

    leaf = createLeafServices({ db, logger, notify, publishDomainChanged });
    updaterService = createUpdaterService({ db, logger, notify });
    updaterService.attachListeners();

    desktopShellService = createDesktopShell({
      db,
      preloadPath,
      rendererDist,
      iconPath,
      isDev,
      devServerUrl,
      windowStatePath,
      isQuittingRef,
      emitEvent,
      notify,
      registerHandle,
      checkForUpdates: async () => {
        const updater = updaterService;
        if (!updater) throw new Error("Updater service is not initialized.");
        await updater.checkForUpdates({ manual: true });
      },
      logger,
    });

    piRuntimeRef.current = createPiRuntimeServices({
      db,
      emitEvent,
      logger,
      refreshConnectorHealth: async (connectorId: string) => {
        if (connectorHealthService) {
          await connectorHealthService.checkConnector(connectorId as never);
        }
      },
    });

    connectorHealthService = createConnectorHealthService({
      db,
      logger,
      publishDomainChanged,
      credentialStore: piRuntimeRef.current.credentialStore,
    });

    workerService = buildWorkerService({
      db,
      logger,
      workerPath,
      isQuittingRef,
      publishDomainChanged,
      emitEvent,
      wakeAgentIfPossible: serviceEvents.wakeAgentIfPossible,
      dispatchRunToWorker: serviceEvents.dispatchRunToWorker,
      processRunCompletion: serviceEvents.processRunCompletion,
      onRunStarted,
      onRunCompleted,
      notify,
      budgetService: leaf.budgetEnforcementService,
      sessionService: leaf.sessionManagementService,
      piRuntimeRef,
      getRuntimeMessageInjector: () => runtimeMessageInjector,
    });

    runtimeMessageInjector = new RuntimeMessageInjector({
      db,
      runtimeBridge: piRuntimeRef.current.runtimeBridge,
      postToWorker: (message) => {
        const worker = workerService?.getWorker();
        if (!worker) throw new Error("Worker is not initialised — cannot deliver steer message.");
        worker.postMessage(message);
      },
      getWakeAgent: () => {
        if (!serviceEvents.hasOrchestrationHandlers()) return null;
        return (agentId, companyId, trigger) => serviceEvents.wakeAgentIfPossible(agentId, companyId, trigger);
      },
      logger,
    });

    orchestrationService = buildOrchestrationService({
      db,
      logger,
      publishDomainChanged,
      emitEvent,
      notify,
      createRunToken,
      getApiPort: () => apiServerRef.current?.port ?? 0,
      isQuittingRef,
      skillService: leaf.skillService,
      budgetService: leaf.budgetEnforcementService,
      sessionService: leaf.sessionManagementService,
      workerService,
      dispatchAutomation: serviceEvents.dispatchAutomation,
      checkpointEngine,
    });
    serviceEvents.registerOrchestration(orchestrationService);

    const background = createBackgroundServices({
      db,
      logger,
      emitEvent,
      publishDomainChanged,
      notify,
      isQuittingRef,
      browserManagerRef,
      skillService: leaf.skillService,
      orchestrationService,
      seedDefaultAutomationRules,
    });
    automationService = background.automationService;
    browserActionService = background.browserActionService;
    onboardingService = background.onboardingService;
    serviceEvents.registerAutomation(automationService);
    serviceEvents.assertReady();
    workerService.createWorker();

    appLifecycleService = createLifecycle({
      db,
      logger,
      isQuittingRef,
      apiServerRef,
      browserManagerRef,
      piRuntimeRef,
      orchestrationService,
      automationService,
      workerService,
      desktopShellService,
      clearServiceRefs: () => {
        desktopShellService = null;
        workerService = null;
        browserActionService = null;
        automationService = null;
        connectorHealthService = null;
        onboardingService = null;
        orchestrationService = null;
        updaterService = null;
        appLifecycleService = null;
        runtimeMessageInjector = null;
        leaf = null;
        serviceEvents.clear();
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
    getOrCreateSkillService: () => requireLeaf().skillService,
    getOrCreateBudgetEnforcementService: () => requireLeaf().budgetEnforcementService,
    getOrCreateSessionManagementService: () => requireLeaf().sessionManagementService,
    getPiRuntime: () => piRuntimeRef.current,
    getRuntimeMessageInjector: () => runtimeMessageInjector,
  };
}
