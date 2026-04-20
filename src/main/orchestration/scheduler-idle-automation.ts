import type { OrchestrationDependencies } from "./types";

export function createIdleAutomationScheduler(deps: OrchestrationDependencies) {
  const { db, logger, dispatchAutomation, hasWorkerReady, isQuitting } = deps;

  let timer: ReturnType<typeof setInterval> | null = null;

  function start() {
    if (timer) clearInterval(timer);

    timer = setInterval(() => {
      try {
        if (isQuitting() || !hasWorkerReady()) return;

        const activeCompanies = db.listActiveCompanyIds();
        const now = Date.now();

        for (const company of activeCompanies) {
          try {
            const companyAgents = db.agents.listActiveAgentsForCompany(company.id);
            for (const agent of companyAgents) {
              if (!db.agents.hasAgentAssignedTasks(agent.id, company.id)) {
                const lastActive = agent.lastHeartbeatAt ? new Date(agent.lastHeartbeatAt).getTime() : 0;
                const idleThreshold = 20 * 60 * 1000;
                if (now - lastActive > idleThreshold) {
                  dispatchAutomation("agent_idle", {
                    companyId: company.id,
                    agentId: agent.id,
                    department: agent.department ?? undefined,
                  });
                }
              }
            }
          } catch (error) {
            logger.error(`[idle-automation] Error processing company ${company.id}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } catch (error) {
        logger.error(`[idle-automation] Scheduler error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, 60_000);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop };
}
