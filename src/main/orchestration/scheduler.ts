import type { OrchestrationDependencies } from "./types";
import { sweepStaleReviews } from "../task-quality-gates";
import type { SweepStaleReviewsDeps } from "../task-quality-gates";
import { resolveApprovalDecision } from "../approval-policy";
import { dispatchAgentMessage } from "../message-dispatch";

export function createScheduler(
  deps: OrchestrationDependencies,
  hasActiveRun: (filter: { taskId?: string; agentId?: string; companyId: string }) => boolean,
  startAgentHeartbeatRun: (agentId: string, companyId: string, trigger: string) => string | null,
  wakeAgentIfPossible: (agentId: string, companyId: string, trigger: string) => string | null | undefined,
) {
  const {
    db,
    logger,
    publishDomainChanged,
    notify,
    dispatchAutomation,
    hasWorkerReady,
    isQuitting,
    budgetService,
  } = deps;

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  const scheduleLastFiredMap = new Map<string, number>();

  function startHeartbeatScheduler() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);

    // One-time cleanup of existing duplicate heartbeat tasks from before the coalescing fix
    try {
      const activeCompanies = db.listActiveCompanyIds();
      for (const company of activeCompanies) {
        const cleaned = db.cleanupDuplicateHeartbeatTasks(company.id);
        if (cleaned > 0) {
          logger.info(`[heartbeat] Cleaned up ${cleaned} duplicate heartbeat task(s) for company ${company.name}`);
        }
      }
    } catch (err) {
      logger.error(`[heartbeat] Heartbeat task cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    heartbeatTimer = setInterval(() => {
      try {
        if (isQuitting() || !hasWorkerReady()) return;

        // D-02: Stale lock recovery piggybacked on heartbeat cycle (EXEC-03)
        try {
          const recovered = db.recoverStaleLocks();
          for (const task of recovered) {
            db.addActivity({
              companyId: task.companyId,
              actor: "system",
              action: "execution.lock_recovered",
              entityType: "task",
              entityId: task.taskId,
              detail: `Recovered stale lock on task "${task.title}" after 15min timeout`,
            });
            logger.info(`[heartbeat] Recovered stale lock on task ${task.taskId}: "${task.title}"`);
          }
        } catch (err) {
          logger.error(`[heartbeat] Stale lock recovery failed: ${err instanceof Error ? err.message : String(err)}`);
        }

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

            const companyAgents = db.listActiveAgentsForCompany(company.id);
            for (const agent of companyAgents) {
              if (!db.hasAgentAssignedTasks(agent.id, company.id)) {
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

            const currentMonth = new Date().toISOString().slice(0, 7);
            const lastResetMonth = db.getLastBudgetResetMonth(company.id) ?? "";
            if (currentMonth !== lastResetMonth) {
              db.resetMonthlyBudgets(company.id);
              db.setLastBudgetResetMonth(company.id, currentMonth);
              logger.info(`[heartbeat] Reset monthly budgets for company ${company.name} (${currentMonth})`);
            }

            // D-06: Auto-close incidents from previous budget windows
            const closedIncidents = budgetService.autoCloseExpiredIncidents(company.id);
            if (closedIncidents > 0) {
              logger.info(`[heartbeat] Auto-closed ${closedIncidents} expired budget incident(s) for company ${company.name}`);
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
                logger.info(`[heartbeat] Auto-escalated ${escalated} stale review(s) for company ${company.name}`);
                publishDomainChanged();
              }
            } catch (error) {
              logger.error(`[heartbeat] Stale review sweep failed: ${error instanceof Error ? error.message : String(error)}`);
            }
          } catch (error) {
            logger.error(`[heartbeat] Error processing company ${company.id}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        try {
          const staleReleased = db.releaseStaleWorkspaceLocks();
          if (staleReleased > 0) {
            logger.info(`[heartbeat] Released ${staleReleased} stale workspace lock(s)`);
            publishDomainChanged();
          }
          const staleWakeups = db.purgeExpiredWakeupRequests();
          if (staleWakeups > 0) {
            logger.info(`[heartbeat] Purged ${staleWakeups} expired wakeup request(s)`);
          }
        } catch (error) {
          logger.error(`[heartbeat] Stale lock cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      } catch (error) {
        logger.error(`[heartbeat] Scheduler error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, 15_000);
  }

  function stopHeartbeatScheduler() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  return { startHeartbeatScheduler, stopHeartbeatScheduler };
}
