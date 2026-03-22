import log from "electron-log/main.js";
import type { AgentApiServer } from "./api-server";
import { initializeAgentTokenSigningKey } from "./agent-auth";
import { bootstrapApplication } from "./bootstrap-application";
import { openConnectorAuthTerminal as openConnectorAuthTerminalImpl } from "./connector-auth-service";
import { getConnectorDefinition } from "./connectors";
import type { AppDatabase } from "./database";
import { seedDefaultAutomationRules as seedDefaultAutomationRulesImpl } from "./default-automation-rules";
import { registerCoreHandlers } from "./ipc-core-handlers";
import { registerDomainHandlers } from "./ipc-domain-handlers";

type BootstrapResult = Awaited<ReturnType<typeof bootstrapApplication>>;

interface MainRuntimeState {
  db: AppDatabase | null;
  apiServer: AgentApiServer | null;
  serviceGraph: BootstrapResult["serviceGraph"] | null;
  ipcSupport: BootstrapResult["ipcSupport"] | null;
}

export function createMainRuntimeSupport(state: MainRuntimeState) {
  function requireDb() {
    if (!state.db) {
      throw new Error("Database is not initialized.");
    }
    return state.db;
  }

  function requireServiceGraph() {
    if (!state.serviceGraph) {
      throw new Error("Service graph is not initialized.");
    }
    return state.serviceGraph;
  }

  function requireIpcSupport() {
    if (!state.ipcSupport) {
      throw new Error("IPC support is not initialized.");
    }
    return state.ipcSupport;
  }

  function requireAutomationService() {
    const service = requireServiceGraph().getAutomationService();
    if (!service) {
      throw new Error("Automation service is not initialized.");
    }
    return service;
  }

  function requireBrowserActionService() {
    const service = requireServiceGraph().getBrowserActionService();
    if (!service) {
      throw new Error("Browser action service is not initialized.");
    }
    return service;
  }

  function requireConnectorHealthService() {
    const service = requireServiceGraph().getConnectorHealthService();
    if (!service) {
      throw new Error("Connector health service is not initialized.");
    }
    return service;
  }

  function requireOnboardingService() {
    const service = requireServiceGraph().getOnboardingService();
    if (!service) {
      throw new Error("Onboarding service is not initialized.");
    }
    return service;
  }

  function requireOrchestrationService() {
    const service = requireServiceGraph().getOrchestrationService();
    if (!service) {
      throw new Error("Orchestration service is not initialized.");
    }
    return service;
  }

  function requireUpdaterService() {
    const service = requireServiceGraph().getUpdaterService();
    if (!service) {
      throw new Error("Updater service is not initialized.");
    }
    return service;
  }

  function emitEvent(event: Parameters<BootstrapResult["ipcSupport"]["emitEvent"]>[0]) {
    requireIpcSupport().emitEvent(event);
  }

  function publishDomainChanged() {
    requireIpcSupport().publishDomainChanged();
  }

  function ensureCompanyExists(companyId: string) {
    return requireIpcSupport().ensureCompanyExists(companyId);
  }

  function findInvalidReference<T extends { id: string | null | undefined; table: string; label: string }>(
    companyId: string,
    refs: T[],
  ) {
    return requireIpcSupport().findInvalidReference(companyId, refs) as T | null;
  }

  function seedDefaultAutomationRules(companyId: string) {
    const db = requireDb();
    seedDefaultAutomationRulesImpl(companyId, {
      listAutomationRuleNames: (targetCompanyId) => db.listAutomationRuleNames(targetCompanyId),
      saveAutomationRule: (input) => db.saveAutomationRule(input),
    });
  }

  function registerHandlers() {
    registerCoreHandlers({
      registerHandle: requireIpcSupport().registerHandle,
      db: requireDb(),
      ensureCompanyExists,
      findInvalidReference,
      publishDomainChanged,
      emitEvent,
      wakeAgentIfPossible: (agentId, companyId, trigger) =>
        requireOrchestrationService().wakeAgentIfPossible(agentId, companyId, trigger),
      handleTaskCreated: (taskId, companyId) => requireAutomationService().handleTaskCreated(taskId, companyId),
      handleTaskStatusChange: (taskId, companyId, previousStatus, newStatus) =>
        requireAutomationService().handleTaskStatusChange(taskId, companyId, previousStatus, newStatus),
      handleApprovalResolved: (approvalId, companyId, decision) =>
        requireAutomationService().handleApprovalResolved(approvalId, companyId, decision),
      dispatchAutomation: (trigger, ctx) => requireAutomationService().dispatchAutomation(trigger, ctx),
      queueTaskRun: (taskId, trigger, actor) =>
        requireOrchestrationService().queueTaskRun(taskId, trigger, actor),
      checkConnector: async (id) => requireConnectorHealthService().checkConnector(id),
      openConnectorAuthTerminal: async (id) => {
        const connector = requireDb().getConnector(id);
        return openConnectorAuthTerminalImpl(id, connector.command);
      },
      checkForUpdates: () => requireUpdaterService().checkForUpdates(),
      getWorkerProcess: () => requireServiceGraph().getWorkerService()?.getWorker() ?? null,
      resetAfterRestore: () => {
        initializeAgentTokenSigningKey(requireDb().profileDir);
        requireBrowserActionService().resetBrowserManager();
      },
      getApiPort: () => state.apiServer?.getPort() ?? 0,
      notify: (options) => requireIpcSupport().notify(options),
      listConnectorModels: async (connectorId) => {
        const definition = getConnectorDefinition(connectorId as Parameters<typeof getConnectorDefinition>[0]);
        return definition.listModels ? definition.listModels() : [];
      },
    });

    registerDomainHandlers({
      registerHandle: requireIpcSupport().registerHandle,
      db: requireDb(),
      logger: log,
      ensureCompanyExists,
      findInvalidReference,
      publishDomainChanged,
      emitEvent,
      wakeAgentIfPossible: (agentId, companyId, trigger) =>
        requireOrchestrationService().wakeAgentIfPossible(agentId, companyId, trigger),
      dispatchAutomation: (trigger, ctx) => requireAutomationService().dispatchAutomation(trigger, ctx),
      runWorkflowPipeline: (workflowId, companyId) =>
        requireAutomationService().runWorkflowPipeline(workflowId, companyId),
      bootstrapOnboarding: (input) => requireOnboardingService().bootstrapOnboarding(input),
      getBrowserActions: () => requireServiceGraph().getBrowserActionService(),
      randomFallbackCompanyId: () => requireConnectorHealthService().randomFallbackCompanyId(),
    });
  }

  return {
    publishDomainChanged,
    seedDefaultAutomationRules,
    registerHandlers,
  };
}
