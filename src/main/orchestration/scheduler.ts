import { powerMonitor } from "electron";
import { logAppError } from "../errors/index.js";
import { resolveApprovalDecision } from "../approval-policy";
import { dispatchAgentMessage } from "../messaging/dispatch";
import { sweepStaleReviews, type SweepStaleReviewsDeps } from "../task-quality-gates";
import type { OrchestrationDependencies } from "./types";

type SchedulerPhase = "lock_recovery" | "housekeeping" | "idle_automation" | "heartbeat_cadence";

const TICK_INTERVAL_MS = 10_000;
const PENDING_WAKE_RETRY_INTERVAL_MS = 120_000;
const PHASE_INTERVAL_MS: Record<SchedulerPhase, number> = {
  lock_recovery: 60_000,
  housekeeping: 300_000,
  idle_automation: 60_000,
  heartbeat_cadence: 60_000,
};

export function createScheduler(
  deps: OrchestrationDependencies,
  hasActiveRun: (filter: { taskId?: string; agentId?: string; companyId: string }) => boolean,
  wakeAgentIfPossible: (agentId: string, companyId: string, trigger: string) => string | null | undefined,
) {
  const {
    db,
    logger,
    publishDomainChanged,
    dispatchAutomation,
    hasWorkerReady,
    isQuitting,
    notify,
    budgetService,
  } = deps;

  let timer: ReturnType<typeof setInterval> | null = null;
  let resumeListener: (() => void) | null = null;
  let unlockListener: (() => void) | null = null;
  const phaseLastRunAt = new Map<SchedulerPhase, number>();
  const scheduleLastFiredByCompany = new Map<string, number>();
  const pendingWakeAttemptByAgent = new Map<string, number>();
  const taskWakeAttemptByAgent = new Map<string, number>();
  const bootstrapAttemptByAgent = new Map<string, number>();

  function phaseIsDue(phase: SchedulerPhase, now: number): boolean {
    const lastRunAt = phaseLastRunAt.get(phase) ?? 0;
    if (now - lastRunAt < PHASE_INTERVAL_MS[phase]) return false;
    phaseLastRunAt.set(phase, now);
    return true;
  }

  function agentAttemptKey(companyId: string, agentId: string): string {
    return `${companyId}:${agentId}`;
  }

  function runLockRecoveryPhase() {
    if (!hasWorkerReady()) return;
    try {
      const recovered = db.recoverStaleLocks();
      for (const task of recovered) {
        db.core.activity.addActivity({
          companyId: task.companyId,
          actor: "system",
          action: "execution.lock_recovered",
          entityType: "task",
          entityId: task.taskId,
          detail: `Recovered stale lock on task "${task.title}" after 15min timeout`,
        });
        logger.info(`[lock-recovery] Recovered stale lock on task ${task.taskId}: "${task.title}"`);
      }
    } catch (error) {
      logAppError(logger, error, {
        kind: "recoverable",
        code: "scheduler.lock_recovery.stale_lock_sweep_failed",
        message: "Stale task lock recovery sweep failed; next tick will retry",
      });
    }

    try {
      const staleReleased = db.core.workspaces.releaseStaleWorkspaceLocks();
      if (staleReleased > 0) {
        logger.info(`[lock-recovery] Released ${staleReleased} stale workspace lock(s)`);
        publishDomainChanged();
      }
    } catch (error) {
      logAppError(logger, error, {
        kind: "recoverable",
        code: "scheduler.lock_recovery.workspace_lock_sweep_failed",
        message: "Stale workspace lock cleanup failed; next tick will retry",
      });
    }
  }

  function runHousekeepingPhase() {
    if (!hasWorkerReady()) return;
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

        const closedIncidents = budgetService.autoCloseExpiredIncidents(company.id);
        if (closedIncidents > 0) {
          logger.info(`[housekeeping] Auto-closed ${closedIncidents} expired budget incident(s) for company ${company.name}`);
        }

        try {
          const sweepDeps: SweepStaleReviewsDeps = {
            db,
            dispatchAgentMessage,
            resolveApprovalDecision,
            notify,
            getCompanyExecutionMode: (companyId: string) => db.core.company.getCompanyExecutionMode(companyId),
            handleTaskStatusChange: (taskId: string, companyId: string, previousStatus: string, newStatus: string) => {
              dispatchAutomation("task_status_changed", { companyId, taskId, previousStatus, newStatus });
              publishDomainChanged();
            },
            handleApprovalResolved: (approvalId: string, companyId: string, _decision: string) => {
              dispatchAutomation("approval_resolved", { companyId });
              publishDomainChanged();
            },
            emitEvent: deps.emitEvent,
            publishDomainChanged,
            wakeAgentIfPossible: (agentId: string | null | undefined, companyId: string, trigger: string) =>
              agentId != null ? wakeAgentIfPossible(agentId, companyId, trigger) ?? null : null,
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
  }

  function runIdleAutomationPhase() {
    if (!hasWorkerReady()) return;
    const activeCompanies = db.core.company.listActiveCompanyIds();
    const now = Date.now();

    for (const company of activeCompanies) {
      try {
        const companyAgents = db.core.agents.listActiveAgentsForCompany(company.id);
        for (const agent of companyAgents) {
          if (db.core.agents.hasAgentAssignedTasks(agent.id, company.id)) continue;
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
      } catch (error) {
        logAppError(logger, error, {
          kind: "recoverable",
          code: "scheduler.idle_automation.company_tick_failed",
          message: `Idle automation tick failed for company ${company.id}`,
          context: { companyId: company.id },
        });
      }
    }
  }

  function runCompanyBootstrap(company: { id: string; name: string }, now: number, wokenAgentIds: Set<string>) {
    const goalCount = db.core.entity.countActiveGoalsForCompany(company.id);
    const advancingCount = db.core.tasks.countAdvancingTasksForCompany(company.id);
    if (goalCount === 0 || advancingCount > 0) return;

    const ceo = db.core.agents.getCeoForCompany(company.id);
    if (!ceo) return;
    if (wokenAgentIds.has(ceo.id)) return;
    if (hasActiveRun({ agentId: ceo.id, companyId: company.id })) return;

    const lastHeartbeat = ceo.lastHeartbeatAt ? new Date(ceo.lastHeartbeatAt).getTime() : 0;
    const lastAttempt = bootstrapAttemptByAgent.get(ceo.id) ?? 0;
    const bootstrapCooldown = 120_000;
    if (now - Math.max(lastHeartbeat, lastAttempt) <= bootstrapCooldown) return;

    bootstrapAttemptByAgent.set(ceo.id, now);
    logger.info(`[scheduler] Company ${company.name} has ${goalCount} goal(s) and no advancing tasks; bootstrapping CEO ${ceo.name}`);
    wakeAgentIfPossible(ceo.id, company.id, "bootstrap");
  }

  function runScheduleAutomation(companyId: string, now: number) {
    const lastScheduleFired = scheduleLastFiredByCompany.get(companyId) ?? 0;
    if (now - lastScheduleFired < 60_000) return;
    dispatchAutomation("schedule", { companyId });
    scheduleLastFiredByCompany.set(companyId, now);
  }

  function runPendingWakeupCadence(companyId: string, now: number): Set<string> {
    const wokenAgentIds = new Set<string>();
    const pendingWakeupAgents = db.automation.wakeup.listPendingWakeupAgents(companyId);
    for (const { agentId } of pendingWakeupAgents) {
      if (hasActiveRun({ agentId, companyId })) continue;
      if (deps.checkpointEngine?.shouldPauseHeartbeat(companyId, agentId)) continue;

      const attemptKey = agentAttemptKey(companyId, agentId);
      const lastAttempt = pendingWakeAttemptByAgent.get(attemptKey) ?? 0;
      if (lastAttempt > 0 && now - lastAttempt < PENDING_WAKE_RETRY_INTERVAL_MS) continue;

      const trigger = db.automation.wakeup.getPreferredWakeTrigger(agentId, companyId);
      if (!trigger) continue;

      pendingWakeAttemptByAgent.set(attemptKey, now);
      const runId = wakeAgentIfPossible(agentId, companyId, trigger);
      if (runId) {
        pendingWakeAttemptByAgent.delete(attemptKey);
        wokenAgentIds.add(agentId);
      }
    }
    return wokenAgentIds;
  }

  function runAssignedTaskWakeCadence(companyId: string, now: number, wokenAgentIds: Set<string>) {
    const activeAgents = db.core.agents.listActiveAgentsForCompany(companyId);
    for (const activeAgent of activeAgents) {
      if (wokenAgentIds.has(activeAgent.id)) continue;
      if (hasActiveRun({ agentId: activeAgent.id, companyId })) continue;
      if (deps.checkpointEngine?.shouldPauseHeartbeat(companyId, activeAgent.id)) continue;

      const lastHeartbeat = activeAgent.lastHeartbeatAt ? new Date(activeAgent.lastHeartbeatAt).getTime() : 0;
      const lastAttempt = taskWakeAttemptByAgent.get(activeAgent.id) ?? 0;
      const intervalMs = (activeAgent.heartbeatIntervalSec || 120) * 1000;
      if (now - Math.max(lastHeartbeat, lastAttempt) < intervalMs) continue;

      const actionableTasks = db.core.tasks.listAgentTasks(activeAgent.id, companyId, ["todo"]);
      if (!actionableTasks.some((task) => !task.activeRunId)) continue;

      taskWakeAttemptByAgent.set(activeAgent.id, now);
      wakeAgentIfPossible(activeAgent.id, companyId, "timer");
    }
  }

  function runHeartbeatCadencePhase() {
    const activeCompanies = db.core.company.listActiveCompanyIds();
    const now = Date.now();

    for (const company of activeCompanies) {
      try {
        runScheduleAutomation(company.id, now);
        const wokenAgentIds = runPendingWakeupCadence(company.id, now);
        runAssignedTaskWakeCadence(company.id, now, wokenAgentIds);
        runCompanyBootstrap(company, now, wokenAgentIds);
      } catch (error) {
        logAppError(logger, error, {
          kind: "recoverable",
          code: "scheduler.heartbeat_cadence.company_tick_failed",
          message: `Heartbeat cadence failed for company ${company.id}`,
          context: { companyId: company.id },
        });
      }
    }
  }

  function runPhase(phase: SchedulerPhase, runner: () => void) {
    try {
      runner();
    } catch (error) {
      logAppError(logger, error, {
        kind: "recoverable",
        code: `scheduler.${phase}.tick_failed`,
        message: `Scheduler phase ${phase} raised; next interval will retry`,
      });
    }
  }

  function runTick() {
    if (isQuitting()) return;
    const now = Date.now();

    if (phaseIsDue("lock_recovery", now)) runPhase("lock_recovery", runLockRecoveryPhase);
    if (phaseIsDue("housekeeping", now)) runPhase("housekeeping", runHousekeepingPhase);
    if (phaseIsDue("idle_automation", now)) runPhase("idle_automation", runIdleAutomationPhase);
    if (phaseIsDue("heartbeat_cadence", now)) runPhase("heartbeat_cadence", runHeartbeatCadencePhase);
  }

  function armTimer() {
    if (timer) clearInterval(timer);
    timer = setInterval(runTick, TICK_INTERVAL_MS);
  }

  function rearm(trigger: string) {
    if (isQuitting()) return;
    logger.info(`[scheduler] Re-arming unified scheduler (${trigger})`);
    armTimer();
    runTick();
  }

  function startAllSchedulers() {
    armTimer();
    if (!resumeListener) {
      resumeListener = () => rearm("power_resume");
      powerMonitor.on("resume", resumeListener);
    }
    if (!unlockListener) {
      unlockListener = () => rearm("screen_unlock");
      powerMonitor.on("unlock-screen", unlockListener);
    }
  }

  function stopAllSchedulers() {
    if (timer) clearInterval(timer);
    timer = null;
    if (resumeListener) {
      powerMonitor.removeListener("resume", resumeListener);
      resumeListener = null;
    }
    if (unlockListener) {
      powerMonitor.removeListener("unlock-screen", unlockListener);
      unlockListener = null;
    }
  }

  return { startAllSchedulers, stopAllSchedulers };
}
