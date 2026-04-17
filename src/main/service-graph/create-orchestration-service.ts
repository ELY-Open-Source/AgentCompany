import type { AppDatabase } from "../database";
import type { DesktopEvent } from "@shared/types";
import { createOrchestrationService } from "../orchestration-service";
import type { createBudgetEnforcementService } from "../budget-enforcement-service";
import type { createSessionManagementService } from "../session-management-service";
import type { createSkillService } from "../skill-service";
import type { createWorkerService } from "../worker-service";
import type { createAutomationService, AutomationEventContext } from "../automation-service";
import type { createBrowserActionService } from "../browser-action-service";
import type { NotificationOptions } from "../notification-service";
import type { LateBinding } from "./late-binding";

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
  automationRef: LateBinding<ReturnType<typeof createAutomationService>>;
  browserActionRef: LateBinding<ReturnType<typeof createBrowserActionService>>;
  checkpointEngine?: { shouldPauseHeartbeat: (companyId: string, agentId: string) => boolean };
}

/**
 * Build the orchestration service with resolved dependencies. Late bindings
 * for automation and browser-action are required because orchestration's
 * dispatchAutomation closure is invoked long after assembly — the slots are
 * filled in the same init() pass, before any scheduler tick.
 */
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
  automationRef,
  checkpointEngine,
}: OrchestrationServiceDeps) {
  const dispatchAutomation = (trigger: string, ctx: AutomationEventContext) => {
    automationRef.get().dispatchAutomation(trigger, ctx);
  };

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
    listRuntimeSkillEntries: (companyId, agentId, connectorId) => {
      try {
        return skillService.listRuntimeSkillEntries(companyId, agentId, connectorId);
      } catch (error) {
        logger.warn(`[service-graph] listRuntimeSkillEntries failed for agent ${agentId}:`, error);
        return [];
      }
    },
    budgetService,
    checkpointEngine,
    getSessionHandoff: (taskId) => {
      try {
        return sessionService.getHandoffContext(taskId);
      } catch (error) {
        logger.warn(`[service-graph] getSessionHandoff failed for task ${taskId}:`, error);
        return null;
      }
    },
    evaluatePreRunSessionRotation: (taskId, connectorId) => {
      try {
        const activeSession = db.getActiveTaskSession(taskId);
        if (!activeSession) return { rotated: false, handoff: null };
        const result = sessionService.evaluateRotation(activeSession, connectorId);
        if (result.shouldRotate) {
          sessionService.rotateSession(activeSession);
          const handoff = sessionService.getHandoffContext(taskId);
          return { rotated: true, handoff };
        }
        return { rotated: false, handoff: null };
      } catch (error) {
        logger.warn(`[service-graph] evaluatePreRunSessionRotation failed for task ${taskId}:`, error);
        return { rotated: false, handoff: null };
      }
    },
  });
}
