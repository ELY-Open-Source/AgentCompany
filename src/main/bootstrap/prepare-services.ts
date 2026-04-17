import type { AgentApiServer } from "../api-server";
import type { AppDatabase } from "../database";
import type { BrowserManager } from "../browser-manager";
import { createServiceGraph } from "../service-graph";
import { createIpcSupport } from "../ipc-support";
import { createNotificationService } from "../notification-service";
import { createThreadIntegration } from "../thread-integration";
import { createCheckpointEngine } from "../checkpoint-engine";
import { createRunHousekeeping } from "../run-housekeeping";
import type { DesktopEvent } from "@shared/types";
import type { NotificationOptions } from "../notification-service";

export interface PrepareServicesDeps {
  db: AppDatabase;
  apiServerRef: { current: AgentApiServer | null };
  browserManagerRef: { current: BrowserManager | null };
  isQuittingRef: { current: boolean };
  preloadPath: string;
  rendererDist: string;
  iconPath: string;
  isDev: boolean;
  devServerUrl?: string;
  devServerOrigin: string | null;
  windowStatePath: string;
  workerPath: string;
  logger: {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  createRunToken: (agentId: string, companyId: string, runId: string) => string;
  seedDefaultAutomationRules: (companyId: string) => void;
}

export interface ServiceGraphHandles {
  serviceGraph: ReturnType<typeof createServiceGraph>;
  ipcSupport: ReturnType<typeof createIpcSupport>;
  threadIntegration: ReturnType<typeof createThreadIntegration>;
  notificationService: ReturnType<typeof createNotificationService>;
  checkpointEngine: ReturnType<typeof createCheckpointEngine>;
  notify: (options: NotificationOptions) => void;
  emitEvent: (event: DesktopEvent) => void;
  publishDomainChanged: () => void;
}

export function prepareServices(deps: PrepareServicesDeps): ServiceGraphHandles {
  let ipcSupport: ReturnType<typeof createIpcSupport> | null = null;
  let serviceGraph: ReturnType<typeof createServiceGraph> | null = null;

  const notificationService = createNotificationService({
    getMainWindow: () => serviceGraph?.getDesktopShellService()?.getMainWindow() ?? null,
    emitEvent: (event: DesktopEvent) => ipcSupport?.emitEvent(event),
    logger: deps.logger,
  });

  const notify = (options: NotificationOptions) => {
    if (!ipcSupport) {
      throw new Error("IPC support is not initialized.");
    }
    ipcSupport.notify(options);
  };
  const emitEvent = (event: DesktopEvent) => ipcSupport?.emitEvent(event);
  const publishDomainChanged = () => ipcSupport?.publishDomainChanged();

  const threadIntegration = createThreadIntegration({
    db: deps.db,
    logger: deps.logger,
    emitEvent,
    publishDomainChanged,
    notify: (options) => notify({ ...options, urgency: "informational" }),
  });
  const checkpointEngine = createCheckpointEngine({
    db: deps.db,
    logger: deps.logger,
    threadIntegration,
    publishDomainChanged,
    notify,
  });
  const runHousekeeping = createRunHousekeeping({
    db: deps.db,
    logger: deps.logger,
    threadIntegration,
  });

  serviceGraph = createServiceGraph({
    db: deps.db,
    apiServerRef: deps.apiServerRef,
    browserManagerRef: deps.browserManagerRef,
    isQuittingRef: deps.isQuittingRef,
    preloadPath: deps.preloadPath,
    rendererDist: deps.rendererDist,
    iconPath: deps.iconPath,
    isDev: deps.isDev,
    devServerUrl: deps.devServerUrl,
    windowStatePath: deps.windowStatePath,
    workerPath: deps.workerPath,
    logger: deps.logger,
    emitEvent,
    publishDomainChanged,
    notify,
    createRunToken: deps.createRunToken,
    seedDefaultAutomationRules: deps.seedDefaultAutomationRules,
    onRunStarted: (runId, taskId, agentId, companyId) =>
      threadIntegration.onRunStarted(runId, taskId, agentId, companyId),
    onRunCompleted: (runId, taskId, agentId, companyId, status, summary, errorMessage) =>
      runHousekeeping.onRunCompleted(runId, taskId, agentId, companyId, status, summary, errorMessage),
    checkpointEngine,
    // Lazy forwarder — ipcSupport is constructed below but only invoked
    // inside serviceGraph.init(), which runs after that point.
    registerHandle: (channel, handler) => {
      if (!ipcSupport) {
        throw new Error("IPC support is not initialized.");
      }
      ipcSupport.registerHandle(channel, handler);
    },
  });
  ipcSupport = createIpcSupport({
    isDev: deps.isDev,
    devServerOrigin: deps.devServerOrigin,
    logger: deps.logger,
    getMainWindow: () => serviceGraph?.getDesktopShellService()?.getMainWindow() ?? null,
    getDb: () => ({
      hasCompany: (companyId: string) => deps.db.hasCompany(companyId),
      belongsToCompany: (table: string, id: string, companyId: string) =>
        deps.db.belongsToCompany(table as Parameters<typeof deps.db.belongsToCompany>[0], id, companyId),
    }),
    notificationService,
  });
  serviceGraph.init();

  return {
    serviceGraph,
    ipcSupport,
    threadIntegration,
    notificationService,
    checkpointEngine,
    notify,
    emitEvent,
    publishDomainChanged,
  };
}
