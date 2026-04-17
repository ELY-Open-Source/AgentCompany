import type { OrchestrationDependencies } from "./types";

export function createHeartbeatScheduler(
  deps: OrchestrationDependencies,
  hasActiveRun: (filter: { taskId?: string; agentId?: string; companyId: string }) => boolean,
  startAgentHeartbeatRun: (agentId: string, companyId: string, trigger: string) => string | null,
) {
  const { db, logger, dispatchAutomation, hasWorkerReady, isQuitting } = deps;

  let timer: ReturnType<typeof setInterval> | null = null;
  const scheduleLastFiredMap = new Map<string, number>();

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

              const lastHeartbeat = agent.lastHeartbeatAt ? new Date(agent.lastHeartbeatAt).getTime() : 0;
              const intervalMs = agent.heartbeatIntervalSec * 1000;
              if (now - lastHeartbeat < intervalMs) continue;

              logger.info(`[heartbeat] Waking agent ${agent.name} (interval: ${agent.heartbeatIntervalSec}s)`);
              startAgentHeartbeatRun(agent.id, company.id, "timer");
            }

            const goalCount = db.countActiveGoalsForCompany(company.id);
            const taskCount = db.countActiveTasksForCompany(company.id);
            if (goalCount > 0 && taskCount === 0) {
              const ceo = db.getCeoForCompany(company.id);
              const ceoLastWake = ceo?.lastHeartbeatAt ? new Date(ceo.lastHeartbeatAt).getTime() : 0;
              const bootstrapCooldown = 120_000;
              if (ceo && !hasActiveRun({ agentId: ceo.id, companyId: company.id }) && (now - ceoLastWake > bootstrapCooldown)) {
                logger.info(`[heartbeat] Company ${company.name} has ${goalCount} goals but no tasks — bootstrapping CEO ${ceo.name}`);
                startAgentHeartbeatRun(ceo.id, company.id, "bootstrap");
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
