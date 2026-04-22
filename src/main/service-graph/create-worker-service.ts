import type { AppDatabase } from "../database";
import type { DesktopEvent } from "@shared/types";
import { createWorkerService } from "../worker-service";
import type { createBudgetEnforcementService } from "../budget-enforcement-service";
import type { createSessionManagementService } from "../session-management-service";
import type { PiRuntimeServices } from "../service-graph-pi-runtime";
import type { NotificationOptions } from "../notification-service";
import type { RuntimeMessageInjector } from "../agent-runtime";
import type { WorkerServiceDependencies } from "../worker/entry/types";

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
  wakeAgentIfPossible: WorkerServiceDependencies["wakeAgentIfPossible"];
  dispatchRunToWorker: WorkerServiceDependencies["dispatchRunToWorker"];
  processRunCompletion: WorkerServiceDependencies["processRunCompletion"];
  onRunStarted?: (runId: string, taskId: string | null, agentId: string, companyId: string) => void;
  onRunCompleted?: (runId: string, taskId: string | null, agentId: string, companyId: string, status: string, summary: string | null, errorMessage: string | null) => void;
  notify: (options: NotificationOptions) => void;
  budgetService: ReturnType<typeof createBudgetEnforcementService>;
  sessionService: ReturnType<typeof createSessionManagementService>;
  piRuntimeRef: { current: PiRuntimeServices | null };
  /**
   * Resolver for the late-constructed runtime message injector. The worker
   * message handler needs it to route `steer-ack` child messages, but the
   * injector is assembled after the worker service itself.
   */
  getRuntimeMessageInjector: () => RuntimeMessageInjector | null;
}

/** Build the worker service with dispatch callbacks supplied by the service event hub. */
export function buildWorkerService(deps: WorkerServiceDeps) {
  const {
    db,
    logger,
    workerPath,
    isQuittingRef,
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
    piRuntimeRef,
    getRuntimeMessageInjector,
  } = deps;

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
    getRuntimeMessageInjector,
  });
}
