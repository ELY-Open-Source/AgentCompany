/**
 * Helpers for assembling orchestration-service dependencies in service-graph.ts.
 * Extracted to keep service-graph.ts under the 400-line cap.
 */

import type { AppDatabase } from "./database";
import { createSkillService } from "./skill-service";
import type { createSessionManagementService } from "./session-management-service";
import type { ProjectedSkill } from "./skill-types";

interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export function makeListRuntimeSkillEntries(deps: { db: AppDatabase; logger: Logger }) {
  let cache: ReturnType<typeof createSkillService> | null = null;
  return (companyId: string, agentId: string, connectorId: string): ProjectedSkill[] => {
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
  return (agentId: string): string | null => {
    try {
      return getSessionService().getHandoffForAgent(agentId);
    } catch (error) {
      deps.logger.warn(`[service-graph] getSessionHandoff failed for agent ${agentId}:`, error);
      return null;
    }
  };
}

export function makePreRunRotationEvaluator(
  deps: { db: AppDatabase; logger: Logger },
  getSessionService: () => ReturnType<typeof createSessionManagementService>,
) {
  return (agentId: string, connectorId: string): { rotated: boolean; handoff: string | null; sessionId: string | null } => {
    try {
      const sessionSvc = getSessionService();
      const agent = deps.db.getAgent(agentId);
      if (!agent.sessionId) return { rotated: false, handoff: null, sessionId: null };
      const session = deps.db.getSessionById(agent.sessionId);
      if (!session) return { rotated: false, handoff: null, sessionId: agent.sessionId };
      const result = sessionSvc.evaluateRotation(session, connectorId);
      if (result.shouldRotate) {
        const newSessionId = sessionSvc.rotateSession(session);
        const handoff = sessionSvc.getHandoffForAgent(agentId);
        return { rotated: true, handoff, sessionId: newSessionId };
      }
      return { rotated: false, handoff: null, sessionId: agent.sessionId };
    } catch (error) {
      deps.logger.warn(`[service-graph] evaluatePreRunSessionRotation failed for agent ${agentId}:`, error);
      return { rotated: false, handoff: null, sessionId: null };
    }
  };
}
