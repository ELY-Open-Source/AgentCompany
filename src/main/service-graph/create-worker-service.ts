import type { AppDatabase } from "../database";
import type { DesktopEvent, RunRecord } from "@shared/types";
import { createWorkerService } from "../worker-service";
import type { createOrchestrationService } from "../orchestration-service";
import type { createAutomationService } from "../automation-service";
import type { createBudgetEnforcementService } from "../budget-enforcement-service";
import type { createSessionManagementService } from "../session-management-service";
import type { PiRuntimeServices } from "../service-graph-pi-runtime";
import type { NotificationOptions } from "../notification-service";
import type { LateBinding } from "./late-binding";

export interface WorkerServiceDeps {
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
  orchestrationRef: LateBinding<ReturnType<typeof createOrchestrationService>>;
  automationRef: LateBinding<ReturnType<typeof createAutomationService>>;
  onRunStarted?: (runId: string, taskId: string | null, agentId: string, companyId: string) => void;
  onRunCompleted?: (runId: string, taskId: string | null, agentId: string, companyId: string, status: string, summary: string | null, errorMessage: string | null) => void;
  notify: (options: NotificationOptions) => void;
  budgetService: ReturnType<typeof createBudgetEnforcementService>;
  sessionService: ReturnType<typeof createSessionManagementService>;
  piRuntimeRef: { current: PiRuntimeServices | null };
}

/**
 * Build the worker service. Orchestration and automation are late-bound via
 * LateBinding slots because they are constructed after the worker but close
 * over the worker's dispatch functions.
 */
export function buildWorkerService(deps: WorkerServiceDeps) {
  const {
    db,
    logger,
    workerPath,
    isQuittingRef,
    publishDomainChanged,
    emitEvent,
    orchestrationRef,
    automationRef,
    onRunStarted,
    onRunCompleted,
    notify,
    budgetService,
    sessionService,
    piRuntimeRef,
  } = deps;

  const wakeAgentIfPossible = (agentId: string | null | undefined, companyId: string, trigger: string) =>
    orchestrationRef.get().wakeAgentIfPossible(agentId, companyId, trigger);

  const dispatchRunToWorker: Parameters<typeof createWorkerService>[0]["dispatchRunToWorker"] = (params) =>
    orchestrationRef.get().dispatchRunToWorker(params);

  const processRunCompletion = (
    run: RunRecord,
    event: Parameters<ReturnType<typeof createAutomationService>["processRunCompletion"]>[1],
  ) => {
    automationRef.get().processRunCompletion(run, event);
  };

  return createWorkerService({
    db,
    logger,
    workerPath,
    isQuitting: () => isQuittingRef.current,
    publishDomainChanged,
    emitEvent,
    wakeAgentIfPossible,
    dispatchRunToWorker,
    processRunCompletion,
    onRunStarted,
    onRunCompleted,
    notify,
    budgetService,
    sessionService,
    getRuntimeBridge: () => piRuntimeRef.current?.runtimeBridge ?? null,
  });
}
