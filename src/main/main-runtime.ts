import { AgentApiServer } from "./api-server";
import { createAgentToken, initializeAgentTokenSigningKey } from "./agent-auth";
import { bootstrapApplication } from "./bootstrap-application";
import { AppDatabase } from "./database";
import { createMainRuntimeSupport } from "./main-runtime-support";

interface CreateMainRuntimeDependencies {
  hasSingleInstanceLock: boolean;
  isDev: boolean;
  devServerOrigin: string | null;
  profileDir: string;
  windowStatePath: string;
  preloadPath: string;
  rendererDist: string;
  iconPath: string;
  workerPath: string;
  devServerUrl?: string;
}

export function createMainRuntime({
  hasSingleInstanceLock,
  isDev,
  devServerOrigin,
  profileDir,
  windowStatePath,
  preloadPath,
  rendererDist,
  iconPath,
  workerPath,
  devServerUrl,
}: CreateMainRuntimeDependencies) {
  const state: {
    db: AppDatabase | null;
    apiServer: AgentApiServer | null;
    serviceGraph: Awaited<ReturnType<typeof bootstrapApplication>>["serviceGraph"] | null;
    ipcSupport: Awaited<ReturnType<typeof bootstrapApplication>>["ipcSupport"] | null;
    isQuitting: boolean;
  } = {
    db: null,
    apiServer: null,
    serviceGraph: null,
    ipcSupport: null,
    isQuitting: false,
  };
  const support = createMainRuntimeSupport(state);

  async function bootstrap() {
    await bootstrapApplication({
      hasSingleInstanceLock,
      isDev,
      devServerOrigin,
      profileDir,
      appDatabaseFactory: (targetProfileDir) => new AppDatabase(targetProfileDir),
      initSigningKey: initializeAgentTokenSigningKey,
      windowStatePath,
      preloadPath,
      rendererDist,
      iconPath,
      devServerUrl,
      workerPath,
      createApiServer: (db, callbacks, allowedOrigins) =>
        new AgentApiServer(
          db,
          support.publishDomainChanged,
          (agentId, companyId, trigger) => callbacks.onWakeAgent(agentId, companyId, trigger),
          callbacks,
          allowedOrigins,
        ),
      createRunToken: createAgentToken,
      seedDefaultAutomationRules: support.seedDefaultAutomationRules,
      isQuittingRef: {
        get current() {
          return state.isQuitting;
        },
        set current(value: boolean) {
          state.isQuitting = value;
        },
      },
      onRuntimeReady: ({ db, apiServer, serviceGraph, ipcSupport }) => {
        state.db = db;
        state.apiServer = apiServer;
        state.serviceGraph = serviceGraph;
        state.ipcSupport = ipcSupport;
        // Register IPC handlers immediately so the renderer can call loadSnapshot()
        // as soon as the window appears — before connector health checks finish.
        support.registerHandlers();
      },
    });
  }

  return {
    bootstrap,
  };
}
