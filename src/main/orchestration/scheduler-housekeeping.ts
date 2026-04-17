import type { OrchestrationDependencies } from "./types";
import { sweepStaleReviews } from "../task-quality-gates";
import type { SweepStaleReviewsDeps } from "../task-quality-gates";
import { resolveApprovalDecision } from "../approval-policy";
import { dispatchAgentMessage } from "../message-dispatch";

export function createHousekeepingScheduler(
  deps: OrchestrationDependencies,
  wakeAgentIfPossible: (agentId: string, companyId: string, trigger: string) => string | null | undefined,
) {
  const {
    db,
    logger,
    publishDomainChanged,
    notify,
    hasWorkerReady,
    isQuitting,
    budgetService,
  } = deps;

  let timer: ReturnType<typeof setInterval> | null = null;

  function start() {
    if (timer) clearInterval(timer);

    timer = setInterval(() => {
      try {
        if (isQuitting() || !hasWorkerReady()) return;

        const activeCompanies = db.listActiveCompanyIds();

        for (const company of activeCompanies) {
          try {
            const currentMonth = new Date().toISOString().slice(0, 7);
            const lastResetMonth = db.getLastBudgetResetMonth(company.id) ?? "";
            if (currentMonth !== lastResetMonth) {
              db.resetMonthlyBudgets(company.id);
              db.setLastBudgetResetMonth(company.id, currentMonth);
              logger.info(`[housekeeping] Reset monthly budgets for company ${company.name} (${currentMonth})`);
            }

            // D-06: Auto-close incidents from previous budget windows
            const closedIncidents = budgetService.autoCloseExpiredIncidents(company.id);
            if (closedIncidents > 0) {
              logger.info(`[housekeeping] Auto-closed ${closedIncidents} expired budget incident(s) for company ${company.name}`);
            }

            // TASK-04: Stale review escalation sweep
            try {
              const sweepDeps: SweepStaleReviewsDeps = {
                db,
                dispatchAgentMessage,
                resolveApprovalDecision,
                notify,
                getCompanyExecutionMode: (cId: string) => db.getCompanyExecutionMode(cId),
                handleTaskStatusChange: (taskId: string, cId: string, previousStatus: string, newStatus: string) => {
                  deps.dispatchAutomation("task_status_changed", { companyId: cId, taskId, previousStatus, newStatus });
                  publishDomainChanged();
                },
                handleApprovalResolved: (approvalId: string, cId: string, _decision: string) => {
                  deps.dispatchAutomation("approval_resolved", { companyId: cId });
                  publishDomainChanged();
                },
                emitEvent: deps.emitEvent,
                publishDomainChanged,
                wakeAgentIfPossible: (agentId: string | null | undefined, cId: string, trigger: string) =>
                  agentId != null ? wakeAgentIfPossible(agentId, cId, trigger) ?? null : null,
                logger,
              };
              const escalated = sweepStaleReviews(company.id, sweepDeps);
              if (escalated > 0) {
                logger.info(`[housekeeping] Auto-escalated ${escalated} stale review(s) for company ${company.name}`);
                publishDomainChanged();
              }
            } catch (error) {
              logger.error(`[housekeeping] Stale review sweep failed: ${error instanceof Error ? error.message : String(error)}`);
            }
          } catch (error) {
            logger.error(`[housekeeping] Error processing company ${company.id}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        try {
          const staleWakeups = db.purgeExpiredWakeupRequests();
          if (staleWakeups > 0) {
            logger.info(`[housekeeping] Purged ${staleWakeups} expired wakeup request(s)`);
          }
        } catch (error) {
          logger.error(`[housekeeping] Wakeup purge failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      } catch (error) {
        logger.error(`[housekeeping] Scheduler error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, 300_000);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop };
}
