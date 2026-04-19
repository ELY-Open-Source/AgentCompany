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
    getSessionHandoff: (agentId) => {
      try {
        return sessionService.getHandoffForAgent(agentId);
      } catch (error) {
        logger.warn(`[service-graph] getSessionHandoff failed for agent ${agentId}:`, error);
        return null;
      }
    },
    evaluatePreRunSessionRotation: (agentId, connectorId) => {
      try {
        const agent = db.getAgent(agentId);
        if (!agent.sessionId) return { rotated: false, handoff: null, sessionId: null };
        const session = db.getSessionById(agent.sessionId);
        if (!session) return { rotated: false, handoff: null, sessionId: agent.sessionId };
        const result = sessionService.evaluateRotation(session);
        if (result.shouldRotate) {
          const newSessionId = sessionService.rotateSession(session);
          const handoff = sessionService.getHandoffForAgent(agentId);
          return { rotated: true, handoff, sessionId: newSessionId };
        }
        return { rotated: false, handoff: null, sessionId: agent.sessionId };
      } catch (error) {
        logger.warn(`[service-graph] evaluatePreRunSessionRotation failed for agent ${agentId}:`, error);
        return { rotated: false, handoff: null, sessionId: null };
      }
    },
  });
}
