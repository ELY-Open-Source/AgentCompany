import { powerMonitor } from "electron";
import { logAppError } from "../errors/index.js";
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
  /**
   * Tracks consecutive skip streak per agent so the per-turn prompt
   * builder (which reads `runtime_state_json` at dispatch time) can
   * surface "skipped: worker_not_ready (last N ticks since T)" and stop
   * being blind to a chain of zero-delivery heartbeats. Keyed by agent
   * id → { reason, count, since }. Reset when status flips to `started`
   * or the reason changes.
   */
  const skipStreakByAgent = new Map<string, { reason: string; count: number; since: string }>();

  /**
   * Periodic heartbeat.skip_ongoing emission gate. The activity table
   * would otherwise show a 5-day gap of blankness while a stall
   * persists, because `writeSkipActivity` used to fire only on
   * first-seen + reason-change. Every SKIP_ONGOING_EVERY_N skips of the
   * same reason we emit one `heartbeat.skip_ongoing` row so the audit
   * timeline carries the running count. At 15s ticks, N=40 ≈ once
   * every ~10 minutes of sustained skipping — readable, not floody.
   */
  const SKIP_ONGOING_EVERY_N = 40;

  function persistSkip(
    agentId: string,
    companyId: string,
    reason: string,
    streak: { count: number; since: string },
    lastTickAt: string,
  ) {
    try {
      const existing = db.agents.getRuntimeState(agentId) as Record<string, unknown>;
      db.agents.setRuntimeState(agentId, companyId, {
        ...existing,
        heartbeatSkip: {
          reason,
          streak: streak.count,
          since: streak.since,
          lastTickAt,
        },
      });
    } catch (error) {
      logAppError(logger, error, {
        kind: "recoverable",
        code: "scheduler.heartbeat.persist_skip_failed",
        message: `Failed to persist heartbeat skip reason for agent ${agentId}`,
        context: { agentId, companyId },
      }, "warn");
    }
  }

  function clearSkip(agentId: string, companyId: string) {
    try {
      const existing = db.agents.getRuntimeState(agentId) as Record<string, unknown>;
      if (!("heartbeatSkip" in existing)) return;
      const next = { ...existing };
      delete next.heartbeatSkip;
      db.agents.setRuntimeState(agentId, companyId, next);
    } catch (error) {
      logAppError(logger, error, {
        kind: "recoverable",
        code: "scheduler.heartbeat.clear_skip_failed",
        message: `Failed to clear heartbeat skip reason for agent ${agentId}`,
        context: { agentId, companyId },
      }, "warn");
    }
  }

  /**
   * Structured skip write to the activity stream. Emits on first skip,
   * on reason change, and every SKIP_ONGOING_EVERY_N consecutive skips
   * of the same reason. That periodic row stops the "5 days of blank
   * activity" pathology — after the initial `heartbeat.skipped` the
   * next visible row used to be the flip/resume, which meant long
   * sleep/standby stalls were invisible in the audit feed.
   *
   * `detail` is emitted as JSON `{reason, streak, since, trigger,
   * agentName}` so downstream readers parse structured fields instead
   * of regexing English. The prompt-side consumer reads
   * `runtime_state_json.heartbeatSkip` (written by `persistSkip`), so
   * activity here is pure audit.
   */
  function writeSkipActivity(
    agentId: string,
    companyId: string,
    agentName: string,
    reason: string,
    trigger: string,
    tickAt: string,
  ): { count: number; since: string } {
    const previous = skipStreakByAgent.get(agentId);
    const sameReason = previous && previous.reason === reason;
    const nextStreak = sameReason
      ? { reason, count: previous.count + 1, since: previous.since }
      : { reason, count: 1, since: tickAt };
    skipStreakByAgent.set(agentId, nextStreak);
    const action = !sameReason
      ? "heartbeat.skipped"
      : nextStreak.count % SKIP_ONGOING_EVERY_N === 0
        ? "heartbeat.skip_ongoing"
        : null;
    if (action) {
      try {
        db.activityMod.addActivity({
          companyId,
          actor: "system",
          action,
          entityType: "agent",
          entityId: agentId,
          detail: JSON.stringify({
            agentName,
            reason,
            streak: nextStreak.count,
            since: nextStreak.since,
            trigger,
          }),
        });
      } catch (error) {
        logAppError(logger, error, {
          kind: "recoverable",
          code: "scheduler.heartbeat.activity_write_failed",
          message: `Failed to append ${action} activity for ${agentName}`,
          context: { agentId, companyId, reason },
        }, "warn");
      }
    }
    return { count: nextStreak.count, since: nextStreak.since };
  }

  function clearSkipStreak(agentId: string, companyId: string, agentName: string) {
    const previous = skipStreakByAgent.get(agentId);
    if (!previous) return;
    skipStreakByAgent.delete(agentId);
    try {
      db.activityMod.addActivity({
        companyId,
        actor: "system",
        action: "heartbeat.skip_cleared",
        entityType: "agent",
        entityId: agentId,
        detail: JSON.stringify({
          agentName,
          reason: previous.reason,
          streak: previous.count,
          since: previous.since,
          resumedAt: new Date().toISOString(),
        }),
      });
    } catch (error) {
      logAppError(logger, error, {
        kind: "recoverable",
        code: "scheduler.heartbeat.activity_write_failed",
        message: `Failed to append heartbeat skip-cleared activity for ${agentName}`,
        context: { agentId, companyId },
      }, "warn");
    }
  }

  function tryWake(agentId: string, companyId: string, agentName: string, trigger: string) {
    const tickAt = new Date().toISOString();
    attemptedAtByAgent.set(agentId, Date.now());
    const result = startAgentHeartbeatRun(agentId, companyId, trigger);
    if (result.status === "skipped") {
      const streak = writeSkipActivity(agentId, companyId, agentName, result.reason, trigger, tickAt);
      persistSkip(agentId, companyId, result.reason, streak, tickAt);
      logger.info(`[heartbeat] ${agentName} not ready: ${result.reason} (streak=${streak.count})`);
    } else {
      clearSkip(agentId, companyId);
      clearSkipStreak(agentId, companyId, agentName);
    }
  }

  function runTick() {
    try {
      if (isQuitting() || !hasWorkerReady()) return;

      const activeCompanies = db.company.listActiveCompanyIds();
      const now = Date.now();

      for (const company of activeCompanies) {
        try {
          const eligibleAgents = db.agents.listHeartbeatEligibleAgents(company.id);

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

          const goalCount = db.entityCrud.countActiveGoalsForCompany(company.id);
          // Bootstrap when the company has active goals but no work is
          // actually advancing. The previous gate ("taskCount === 0")
          // missed the case where every task is in_review or blocked —
          // the company looks busy to the counter but produces zero
          // progress, and the CEO would not be woken until the next
          // regular timer interval. countAdvancingTasksForCompany
          // counts only todo + in_progress so bootstrapping still
          // fires once the team stalls.
          const advancingCount = db.tasks.countAdvancingTasksForCompany(company.id);
          if (goalCount > 0 && advancingCount === 0) {
            const ceo = db.agents.getCeoForCompany(company.id);
            const ceoLastWake = ceo?.lastHeartbeatAt ? new Date(ceo.lastHeartbeatAt).getTime() : 0;
            const ceoLastAttempt = ceo ? attemptedAtByAgent.get(ceo.id) ?? 0 : 0;
            const ceoLastTouch = Math.max(ceoLastWake, ceoLastAttempt);
            const bootstrapCooldown = 120_000;
            if (ceo && !hasActiveRun({ agentId: ceo.id, companyId: company.id }) && (now - ceoLastTouch > bootstrapCooldown)) {
              logger.info(`[heartbeat] Company ${company.name} has ${goalCount} goal(s) and no advancing tasks — bootstrapping CEO ${ceo.name}`);
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
          logAppError(logger, error, {
            kind: "recoverable",
            code: "scheduler.heartbeat.company_tick_failed",
            message: `Heartbeat tick failed for company ${company.id}`,
            context: { companyId: company.id },
          });
        }
      }
    } catch (error) {
      logAppError(logger, error, {
        kind: "recoverable",
        code: "scheduler.heartbeat.tick_failed",
        message: "Heartbeat scheduler tick raised; next interval will retry",
      });
    }
  }

  /**
   * Re-arm the interval after OS resume. On Windows (and to a lesser
   * extent macOS App Nap), `setInterval` is throttled to ≥1 minute and
   * sometimes stalls entirely across sleep/standby cycles — which is
   * exactly why agents went 4+ days without a single successful
   * heartbeat. We can't trust the handle to fire on schedule after
   * resume, so we clear it, run one tick immediately to catch up, and
   * restart the interval with a fresh timer. Idempotent; safe to call
   * during normal operation.
   */
  function rearm(trigger: string) {
    if (isQuitting()) return;
    logger.info(`[heartbeat] Re-arming scheduler (${trigger})`);
    if (timer) clearInterval(timer);
    timer = setInterval(runTick, 15_000);
    runTick();
  }

  let resumeListener: (() => void) | null = null;
  let unlockListener: (() => void) | null = null;

  function start() {
    if (timer) clearInterval(timer);
    timer = setInterval(runTick, 15_000);

    // Windows/macOS: when the OS resumes from sleep or the screen
    // unlocks, setInterval timers set before sleep are unreliable
    // (Windows modern-standby throttles background timers to minute
    // granularity and can drop pending fires entirely). Listening to
    // powerMonitor is the documented Electron path to get a
    // deterministic kick that doesn't depend on a user clicking the
    // window. Without this the CEO heartbeat silently stops firing
    // whenever the laptop lid closes overnight.
    if (!resumeListener) {
      resumeListener = () => rearm("power_resume");
      powerMonitor.on("resume", resumeListener);
    }
    if (!unlockListener) {
      unlockListener = () => rearm("screen_unlock");
      // `unlock-screen` fires on Windows/macOS when the user returns
      // from a locked screen without a full sleep cycle — common path
      // for "I left the app open, locked, came back, agents dead".
      powerMonitor.on("unlock-screen", unlockListener);
    }
  }

  function stop() {
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

  return { start, stop };
}
