import type { AppDatabase } from "../database";
import type { DesktopEvent } from "@shared/types";
import { createWorkerService } from "../worker-service";
import { createOrchestrationService } from "../orchestration-service";
import type { createBudgetEnforcementService } from "../budget-enforcement-service";
import type { createSessionManagementService } from "../session-management-service";
import type { createSkillService } from "../skill-service";
import type { PiRuntimeServices } from "../service-graph-pi-runtime";
import type { NotificationOptions } from "../notification-service";
import type { RuntimeMessageInjector } from "../agent-runtime";
import type { WorkerServiceDependencies } from "../worker/entry/types";
import type { OrchestrationDependencies } from "../orchestration/types";

export interface RuntimeOrchestrationServiceDeps {
  db: AppDatabase;
  logger: {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  workerPath: string;
  isQuittingRef: { current: boolean };
  publishDomainChanged: () => void;
  emitEvent: (event: DesktopEvent) => void;
  notify: (options: NotificationOptions) => void;
  createRunToken: (agentId: string, companyId: string, runId: string) => string;
  getApiPort: () => number;
  skillService: ReturnType<typeof createSkillService>;
  budgetService: ReturnType<typeof createBudgetEnforcementService>;
  sessionService: ReturnType<typeof createSessionManagementService>;
  piRuntimeRef: { current: PiRuntimeServices | null };
  getRuntimeMessageInjector: () => RuntimeMessageInjector | null;
  onRunStarted?: (runId: string, taskId: string | null, agentId: string, companyId: string) => void;
  onRunCompleted?: (
    runId: string,
    taskId: string | null,
    agentId: string,
    companyId: string,
    status: string,
    summary: string | null,
    errorMessage: string | null,
  ) => void;
  checkpointEngine?: { shouldPauseHeartbeat: (companyId: string, agentId: string) => boolean };
}

type AutomationHandlers = {
  dispatchAutomation: OrchestrationDependencies["dispatchAutomation"];
  processRunCompletion: WorkerServiceDependencies["processRunCompletion"];
};

/**
 * Owns the two halves of the run execution loop as one object:
 * orchestration decides which run should start, and the worker service
 * owns the utility process that executes it. Keeping both in one factory
 * removes the service-graph event hub from the hot run path.
 */
export function createRuntimeOrchestrationService(deps: RuntimeOrchestrationServiceDeps) {
  const {
    db,
    logger,
    workerPath,
    isQuittingRef,
    publishDomainChanged,
    emitEvent,
    notify,
    createRunToken,
    getApiPort,
    skillService,
    budgetService,
    sessionService,
    piRuntimeRef,
    getRuntimeMessageInjector,
    onRunStarted,
    onRunCompleted,
    checkpointEngine,
  } = deps;

  let automationHandlers: AutomationHandlers | null = null;
  let orchestrationService: ReturnType<typeof createOrchestrationService> | null = null;

  function requireAutomation(): AutomationHandlers {
    if (!automationHandlers) {
      throw new Error("Runtime orchestration automation handlers are not bound.");
    }
    return automationHandlers;
  }

  function requireOrchestration(): ReturnType<typeof createOrchestrationService> {
    if (!orchestrationService) {
      throw new Error("Runtime orchestration service is not initialized.");
    }
    return orchestrationService;
  }

  const workerService = createWorkerService({
    db,
    logger,
    workerPath,
    isQuitting: () => isQuittingRef.current,
    publishDomainChanged,
    emitEvent,
    wakeAgentIfPossible: (agentId, companyId, trigger) =>
      requireOrchestration().wakeAgentIfPossible(agentId, companyId, trigger),
    dispatchRunToWorker: (params) => {
      requireOrchestration().dispatchRunToWorker(params);
    },
    processRunCompletion: (run, event) => {
      requireAutomation().processRunCompletion(run, event);
    },
    onRunStarted,
    onRunCompleted,
    notify,
    budgetService,
    sessionService,
    getRuntimeBridge: () => piRuntimeRef.current?.runtimeBridge ?? null,
    getRuntimeMessageInjector,
  });

  orchestrationService = createOrchestrationService({
    db,
    logger,
    publishDomainChanged,
    emitEvent,
    notify,
    createRunToken,
    getApiPort,
    dispatchAutomation: (trigger, ctx) => {
      requireAutomation().dispatchAutomation(trigger, ctx);
    },
    hasWorkerReady: () => Boolean(workerService.getWorker()),
    enqueueWorkerRun: (payload) => {
      workerService.getWorker()?.postMessage({ type: "enqueue-run", payload });
    },
    isQuitting: () => isQuittingRef.current,
    listRuntimeSkillEntries: (companyId, agentId, connectorId) =>
      skillService.listRuntimeSkillEntries(companyId, agentId, connectorId),
    budgetService,
    checkpointEngine,
    getSessionHandoff: (agentId) => sessionService.getHandoffForAgent(agentId),
    evaluatePreRunSessionRotation: (agentId, _connectorId) => {
      const agent = db.core.entity.getAgent(agentId);
      if (!agent.sessionId) return { rotated: false, handoff: null, sessionId: null };
      const session = db.core.tasks.getSessionById(agent.sessionId);
      if (!session) return { rotated: false, handoff: null, sessionId: agent.sessionId };
      const result = sessionService.evaluateRotation(session);
      if (result.shouldRotate) {
        const newSessionId = sessionService.rotateSession(session);
        const handoff = sessionService.getHandoffForAgent(agentId);
        return { rotated: true, handoff, sessionId: newSessionId };
      }
      return { rotated: false, handoff: null, sessionId: agent.sessionId };
    },
  });

  return {
    bindAutomation(service: AutomationHandlers): void {
      if (automationHandlers) {
        throw new Error("Runtime orchestration automation handlers are already bound.");
      }
      automationHandlers = service;
    },
    assertReady(): void {
      requireAutomation();
      requireOrchestration();
    },
    createWorker: workerService.createWorker,
    getWorker: workerService.getWorker,
    shutdown: workerService.shutdown,
    destroy: workerService.destroy,
    resolveWorkspace: (...args: Parameters<ReturnType<typeof createOrchestrationService>["resolveWorkspace"]>) =>
      requireOrchestration().resolveWorkspace(...args),
    wakeAgentIfPossible: (...args: Parameters<ReturnType<typeof createOrchestrationService>["wakeAgentIfPossible"]>) =>
      requireOrchestration().wakeAgentIfPossible(...args),
    dispatchRunToWorker: (...args: Parameters<ReturnType<typeof createOrchestrationService>["dispatchRunToWorker"]>) =>
      requireOrchestration().dispatchRunToWorker(...args),
    queueTaskRun: (...args: Parameters<ReturnType<typeof createOrchestrationService>["queueTaskRun"]>) =>
      requireOrchestration().queueTaskRun(...args),
    createTaskRunForDeferredDispatch: (
      ...args: Parameters<ReturnType<typeof createOrchestrationService>["createTaskRunForDeferredDispatch"]>
    ) => requireOrchestration().createTaskRunForDeferredDispatch(...args),
    resumeQueuedRuns: (...args: Parameters<ReturnType<typeof createOrchestrationService>["resumeQueuedRuns"]>) =>
      requireOrchestration().resumeQueuedRuns(...args),
    startAgentHeartbeatRun: (
      ...args: Parameters<ReturnType<typeof createOrchestrationService>["startAgentHeartbeatRun"]>
    ) => requireOrchestration().startAgentHeartbeatRun(...args),
    startAllSchedulers: (...args: Parameters<ReturnType<typeof createOrchestrationService>["startAllSchedulers"]>) =>
      requireOrchestration().startAllSchedulers(...args),
    stopAllSchedulers: (...args: Parameters<ReturnType<typeof createOrchestrationService>["stopAllSchedulers"]>) =>
      requireOrchestration().stopAllSchedulers(...args),
  };
}
