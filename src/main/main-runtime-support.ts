import log from "electron-log/main.js";
import type { AgentApiServer } from "./api-server";
import { initializeAgentTokenSigningKey } from "./agent-auth";
import { bootstrapApplication } from "./bootstrap-application";
import { openGenericTerminal as openGenericTerminalImpl } from "./connector-auth-service";
import type { ConnectorId } from "@shared/types";
import type { AppDatabase } from "./database";
import { seedDefaultAutomationRules as seedDefaultAutomationRulesImpl } from "./default-automation-rules";
import { registerCoreHandlers } from "./ipc-core-handlers";
import { registerDomainHandlers } from "./ipc-domain-handlers";
import { registerCredentialIpcHandlers } from "./ipc-credentials-handlers";
import { registerOAuthIpcHandlers } from "./ipc-oauth-handlers";
import { fail } from "./ipc-core-common";
import type { ThreadIntegrationService } from "./thread-integration";

type BootstrapResult = Awaited<ReturnType<typeof bootstrapApplication>>;

interface MainRuntimeState {
  db: AppDatabase | null;
  apiServer: AgentApiServer | null;
  serviceGraph: BootstrapResult["serviceGraph"] | null;
  ipcSupport: BootstrapResult["ipcSupport"] | null;
  threadIntegration: ThreadIntegrationService | null;
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
      handleApprovalCreated: (approvalId, companyId, taskId, approvalType, summary) => {
        state.threadIntegration?.onApprovalCreated(approvalId, companyId, taskId, approvalType, summary);
      },
      handleApprovalResolved: (approvalId, companyId, decision) => {
        requireAutomationService().handleApprovalResolved(approvalId, companyId, decision);
        state.threadIntegration?.onApprovalResolved(approvalId, companyId, decision);
      },
      dispatchAutomation: (trigger, ctx) => requireAutomationService().dispatchAutomation(trigger, ctx),
      queueTaskRun: (taskId, trigger, actor) =>
        requireOrchestrationService().queueTaskRun(taskId, trigger, actor),
      checkConnector: async (id) => requireConnectorHealthService().checkConnector(id),
      openGenericTerminal: (input) => openGenericTerminalImpl(input),
      checkForUpdates: () => requireUpdaterService().checkForUpdates(),
      getWorkerProcess: () => requireServiceGraph().getWorkerService()?.getWorker() ?? null,
      resetAfterRestore: () => {
        initializeAgentTokenSigningKey(requireDb().profileDir);
        void requireBrowserActionService().resetBrowserManager();
      },
      notify: (options) => requireIpcSupport().notify(options),
      listConnectorModels: async (connectorId) => {
        // This IPC returns the raw provider catalog (pi-ai + curated
        // Fireworks additions). Pool / disabled-model filtering is a
        // company-scoped concern and happens in the renderer once the
        // user has selected a company; the onboarding path uses this
        // catalog directly because no company exists yet.
        const { getConnectorDefinition } = await import("./connectors");
        const { resolveModels } = await import("./model-resolver");
        const definition = getConnectorDefinition(connectorId as ConnectorId);
        return resolveModels(definition.provider).map((m) => ({ id: m.id, label: m.name }));
      },
      logger: log,
    });

    registerDomainHandlers({
      registerHandle: requireIpcSupport().registerHandle,
      db: requireDb(),
      logger: log,
      ensureCompanyExists,
      findInvalidReference,
      publishDomainChanged,
      emitEvent,
      notify: (options) => requireIpcSupport().notify(options),
      wakeAgentIfPossible: (agentId, companyId, trigger) =>
        requireOrchestrationService().wakeAgentIfPossible(agentId, companyId, trigger),
      dispatchAutomation: (trigger, ctx) => requireAutomationService().dispatchAutomation(trigger, ctx),
      runWorkflowPipeline: (workflowId, companyId) =>
        requireAutomationService().runWorkflowPipeline(workflowId, companyId),
      bootstrapOnboarding: (input) => requireOnboardingService().bootstrapOnboarding(input),
      getBrowserActions: () => requireServiceGraph().getBrowserActionService(),
      randomFallbackCompanyId: () => requireConnectorHealthService().randomFallbackCompanyId(),
      skillService: requireServiceGraph().getOrCreateSkillService(),
      budgetService: requireServiceGraph().getOrCreateBudgetEnforcementService(),
      onHumanMessage: (companyId: string, toAgentId?: string | null, threadId?: string | null, waitStateId?: string | null) => {
        if (state.threadIntegration) {
          state.threadIntegration.onHumanMessage(companyId, toAgentId, threadId, waitStateId);
        }
        publishDomainChanged();
      },
    });

    const piRuntime = requireServiceGraph().getPiRuntime();
    if (!piRuntime) {
      throw new Error("Pi-mono runtime services are not initialized.");
    }

    registerCredentialIpcHandlers({
      store: piRuntime.credentialStore,
      resolver: piRuntime.credentialResolver,
      registerHandle: requireIpcSupport().registerHandle,
      emitEvent,
      refreshConnectorHealth: async (connectorId) => {
        await requireConnectorHealthService().checkConnector(connectorId as ConnectorId);
      },
      fail,
      logger: log,
    });

    registerOAuthIpcHandlers({
      service: piRuntime.oauthLoginService,
      registerHandle: requireIpcSupport().registerHandle,
      fail,
      logger: log,
    });
  }

  return {
    publishDomainChanged,
    seedDefaultAutomationRules,
    registerHandlers,
  };
}
