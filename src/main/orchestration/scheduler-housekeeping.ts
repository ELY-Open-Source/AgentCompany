import type { OrchestrationDependencies } from "./types";
import { sweepStaleReviews } from "../task-quality-gates";
import type { SweepStaleReviewsDeps } from "../task-quality-gates";
import { resolveApprovalDecision } from "../approval-policy";
import { dispatchAgentMessage } from "../messaging/dispatch";
import { logAppError } from "../errors/index.js";

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

        const activeCompanies = db.core.company.listActiveCompanyIds();

        for (const company of activeCompanies) {
          try {
            const currentMonth = new Date().toISOString().slice(0, 7);
            const lastResetMonth = db.core.settings.getLastBudgetResetMonth(company.id) ?? "";
            if (currentMonth !== lastResetMonth) {
              db.core.agents.resetMonthlyBudgets(company.id);
              db.core.settings.setLastBudgetResetMonth(company.id, currentMonth);
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
                getCompanyExecutionMode: (cId: string) => db.core.company.getCompanyExecutionMode(cId),
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
              logAppError(logger, error, {
                kind: "recoverable",
                code: "scheduler.housekeeping.stale_review_sweep_failed",
                message: `Stale review sweep failed for company ${company.id}`,
                context: { companyId: company.id },
              });
            }
          } catch (error) {
            logAppError(logger, error, {
              kind: "recoverable",
              code: "scheduler.housekeeping.company_tick_failed",
              message: `Housekeeping tick failed for company ${company.id}`,
              context: { companyId: company.id },
            });
          }
        }

        try {
          const staleWakeups = db.automation.wakeup.purgeExpiredWakeupRequests();
          if (staleWakeups > 0) {
            logger.info(`[housekeeping] Purged ${staleWakeups} expired wakeup request(s)`);
          }
        } catch (error) {
          logAppError(logger, error, {
            kind: "recoverable",
            code: "scheduler.housekeeping.wakeup_purge_failed",
            message: "Expired wakeup request purge failed; next tick will retry",
          });
        }

        try {
          // agent_message_projections accumulates one row per (inbox
          // message, session) forever. Once a session has rotated away
          // — no agent references it as its current session_id — its
          // projection rows only consume disk. Keep a 24h safety margin
          // so an active rotation window cannot strip the ledger out
          // from under a live run.
          const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const purgedProjections = db.projection.inbox.purgeOrphanProjections(cutoff);
          if (purgedProjections > 0) {
            logger.info(`[housekeeping] Purged ${purgedProjections} orphan inbox projection ledger row(s)`);
          }
        } catch (error) {
          logAppError(logger, error, {
            kind: "recoverable",
            code: "scheduler.housekeeping.inbox_projection_purge_failed",
            message: "Orphan inbox projection purge failed; next tick will retry",
          });
        }
      } catch (error) {
        logAppError(logger, error, {
          kind: "recoverable",
          code: "scheduler.housekeeping.tick_failed",
          message: "Housekeeping scheduler tick raised; next interval will retry",
        });
      }
    }, 300_000);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop };
}
