/**
 * Helpers for assembling orchestration-service dependencies in service-graph.ts.
 * Extracted to keep service-graph.ts under the 400-line cap.
 */

import type { AppDatabase } from "./database";
import { createSkillService } from "./skill-service";
import type { createSessionManagementService } from "./session-management-service";
import type { RuntimeSkillEntry } from "./skill-types";

interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export function makeListRuntimeSkillEntries(deps: { db: AppDatabase; logger: Logger }) {
  let cache: ReturnType<typeof createSkillService> | null = null;
  return (companyId: string, agentId: string, connectorId: string): RuntimeSkillEntry[] => {
    try {
      if (!cache) cache = createSkillService({ db: deps.db, profileDir: deps.db.profileDir, logger: deps.logger });
      return cache.listRuntimeSkillEntries(companyId, agentId, connectorId);
    } catch (error) {
      deps.logger.warn(`[service-graph] listRuntimeSkillEntries failed for agent ${agentId}:`, error);
      return [];
    }
  };
}

export function makeSessionHandoffLookup(
  deps: { logger: Logger },
  getSessionService: () => ReturnType<typeof createSessionManagementService>,
) {
  return (taskId: string): string | null => {
    try {
      return getSessionService().getHandoffContext(taskId);
    } catch (error) {
      deps.logger.warn(`[service-graph] getSessionHandoff failed for task ${taskId}:`, error);
      return null;
    }
  };
}

export function makePreRunRotationEvaluator(
  deps: { db: AppDatabase; logger: Logger },
  getSessionService: () => ReturnType<typeof createSessionManagementService>,
) {
  return (taskId: string, connectorId: string): { rotated: boolean; handoff: string | null } => {
    try {
      const sessionSvc = getSessionService();
      const activeSession = deps.db.getActiveTaskSession(taskId);
      if (!activeSession) return { rotated: false, handoff: null };
      const result = sessionSvc.evaluateRotation(activeSession, connectorId);
      if (result.shouldRotate) {
        sessionSvc.rotateSession(activeSession);
        const handoff = sessionSvc.getHandoffContext(taskId);
        return { rotated: true, handoff };
      }
      return { rotated: false, handoff: null };
    } catch (error) {
      deps.logger.warn(`[service-graph] evaluatePreRunSessionRotation failed for task ${taskId}:`, error);
      return { rotated: false, handoff: null };
    }
  };
}
