import type { HeartbeatStartResult } from "./heartbeat";
import type { OrchestrationDependencies } from "./types";

export function createHeartbeatScheduler(
  deps: OrchestrationDependencies,
  hasActiveRun: (filter: { taskId?: string; agentId?: string; companyId: string }) => boolean,
  startAgentHeartbeatRun: (agentId: string, companyId: string, trigger: string) => HeartbeatStartResult,
) {
  const { db, logger, dispatchAutomation, hasWorkerReady, isQuitting } = deps;

  let timer: ReturnType<typeof setInterval> | null = null;
  const scheduleLastFiredMap = new Map<string, number>();
  /**
   * Per-agent last-attempt timestamp. Needed so that attempts which
   * return `skipped` still respect the heartbeat interval on the next
   * tick — otherwise `lastHeartbeatAt` (which only advances on success)
   * leaves the agent in a 15-second retry loop spamming logs and the
   * activity table. Keyed by agent id. In-memory is fine: on restart
   * the scheduler starts with a clean slate, and `lastHeartbeatAt`
   * plus the first skip-and-record cycle re-establish backoff.
   */
  const attemptedAtByAgent = new Map<string, number>();

  function persistSkip(agentId: string, companyId: string, reason: string) {
    try {
      const existing = db.getRuntimeState(agentId) as Record<string, unknown>;
      db.setRuntimeState(agentId, companyId, {
        ...existing,
        heartbeatSkip: { reason, at: new Date().toISOString() },
      });
    } catch (error) {
      logger.warn(
        `[heartbeat] Failed to persist skip reason for agent ${agentId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  function clearSkip(agentId: string, companyId: string) {
    try {
      const existing = db.getRuntimeState(agentId) as Record<string, unknown>;
      if (!("heartbeatSkip" in existing)) return;
      const next = { ...existing };
      delete next.heartbeatSkip;
      db.setRuntimeState(agentId, companyId, next);
    } catch (error) {
      logger.warn(
        `[heartbeat] Failed to clear skip reason for agent ${agentId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  function tryWake(agentId: string, companyId: string, agentName: string, trigger: string) {
    attemptedAtByAgent.set(agentId, Date.now());
    const result = startAgentHeartbeatRun(agentId, companyId, trigger);
    if (result.status === "skipped") {
      persistSkip(agentId, companyId, result.reason);
      logger.info(`[heartbeat] ${agentName} not ready: ${result.reason}`);
    } else {
      clearSkip(agentId, companyId);
    }
  }

  function start() {
    if (timer) clearInterval(timer);

    timer = setInterval(() => {
      try {
        if (isQuitting() || !hasWorkerReady()) return;

        const activeCompanies = db.listActiveCompanyIds();
        const now = Date.now();

        for (const company of activeCompanies) {
          try {
            const eligibleAgents = db.listHeartbeatEligibleAgents(company.id);

            for (const agent of eligibleAgents) {
              if (hasActiveRun({ agentId: agent.id, companyId: company.id })) continue;

              // Unified co-founder mode pause: checkpoint engine checks mode + wait states + pending approvals
              if (deps.checkpointEngine?.shouldPauseHeartbeat(company.id, agent.id)) {
                continue;
              }

              // Use the max of last-success and last-attempt so a chain
              // of skipped attempts still cools down the cycle instead
              // of retrying on every 15-second tick.
              const lastHeartbeat = agent.lastHeartbeatAt ? new Date(agent.lastHeartbeatAt).getTime() : 0;
              const lastAttempt = attemptedAtByAgent.get(agent.id) ?? 0;
              const lastTouch = Math.max(lastHeartbeat, lastAttempt);
              const intervalMs = agent.heartbeatIntervalSec * 1000;
              if (now - lastTouch < intervalMs) continue;

              tryWake(agent.id, company.id, agent.name, "timer");
            }

            const goalCount = db.countActiveGoalsForCompany(company.id);
            const taskCount = db.countActiveTasksForCompany(company.id);
            if (goalCount > 0 && taskCount === 0) {
              const ceo = db.getCeoForCompany(company.id);
              const ceoLastWake = ceo?.lastHeartbeatAt ? new Date(ceo.lastHeartbeatAt).getTime() : 0;
              const ceoLastAttempt = ceo ? attemptedAtByAgent.get(ceo.id) ?? 0 : 0;
              const ceoLastTouch = Math.max(ceoLastWake, ceoLastAttempt);
              const bootstrapCooldown = 120_000;
              if (ceo && !hasActiveRun({ agentId: ceo.id, companyId: company.id }) && (now - ceoLastTouch > bootstrapCooldown)) {
                logger.info(`[heartbeat] Company ${company.name} has ${goalCount} goals but no tasks — bootstrapping CEO ${ceo.name}`);
                tryWake(ceo.id, company.id, ceo.name, "bootstrap");
              }
            }

            const scheduleKey = `schedule-${company.id}`;
            const lastScheduleFired = scheduleLastFiredMap.get(scheduleKey) ?? 0;
            if (now - lastScheduleFired >= 60_000) {
              dispatchAutomation("schedule", { companyId: company.id });
              scheduleLastFiredMap.set(scheduleKey, now);
            }
          } catch (error) {
            logger.error(`[heartbeat] Error processing company ${company.id}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } catch (error) {
        logger.error(`[heartbeat] Scheduler error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, 15_000);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop };
}
