import type { AppDatabase } from "../database";
import type { DesktopEvent } from "@shared/types";
import { createOrchestrationService } from "../orchestration-service";
import type { createBudgetEnforcementService } from "../budget-enforcement-service";
import type { createSessionManagementService } from "../session-management-service";
import type { createSkillService } from "../skill-service";
import type { createWorkerService } from "../worker-service";
import type { NotificationOptions } from "../notification-service";
import type { OrchestrationDependencies } from "../orchestration/types";

export interface OrchestrationServiceDeps {
  db: AppDatabase;
  logger: {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  publishDomainChanged: () => void;
  emitEvent: (event: DesktopEvent) => void;
  notify: (options: NotificationOptions) => void;
  createRunToken: (agentId: string, companyId: string, runId: string) => string;
  getApiPort: () => number;
  isQuittingRef: { current: boolean };
  skillService: ReturnType<typeof createSkillService>;
  budgetService: ReturnType<typeof createBudgetEnforcementService>;
  sessionService: ReturnType<typeof createSessionManagementService>;
  workerService: ReturnType<typeof createWorkerService>;
  dispatchAutomation: OrchestrationDependencies["dispatchAutomation"];
  checkpointEngine?: { shouldPauseHeartbeat: (companyId: string, agentId: string) => boolean };
}

/** Build the orchestration service with concrete worker wiring and event dispatch. */
export function buildOrchestrationService({
  db,
  logger,
  publishDomainChanged,
  emitEvent,
  notify,
  createRunToken,
  getApiPort,
  isQuittingRef,
  skillService,
  budgetService,
  sessionService,
  workerService,
  dispatchAutomation,
  checkpointEngine,
}: OrchestrationServiceDeps) {
  return createOrchestrationService({
    db,
    logger,
    publishDomainChanged,
    emitEvent,
    notify,
    createRunToken,
    getApiPort,
    dispatchAutomation,
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
      const agent = db.entityCrud.getAgent(agentId);
      if (!agent.sessionId) return { rotated: false, handoff: null, sessionId: null };
      const session = db.tasks.getSessionById(agent.sessionId);
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
}
