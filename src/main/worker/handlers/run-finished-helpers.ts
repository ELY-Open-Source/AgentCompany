import type { z } from "zod";
import { createCircuitBreaker } from "../circuit-breaker";
import { handleFailureEscalation, handleSuccessReset } from "../failure-escalation";
import { persistRunEvent } from "../run-event-recorder";
import type { workerMessageSchema } from "../worker-types";
import type { HandlerContext, HandlerDeps, WorkerMessageEvent } from "./handler-context";

type RunFinishedEvent = Extract<WorkerMessageEvent, { type: "run-finished" }>;
type RunRecord = ReturnType<HandlerDeps["db"]["getRun"]>;
type TaskRecord = ReturnType<HandlerDeps["db"]["getTask"]>;

export interface RunFinishedContext {
  run: RunRecord;
  task: TaskRecord | null;
  runOutcome: ReturnType<HandlerDeps["db"]["finishRun"]>;
}

export function finalizeRun(
  event: RunFinishedEvent,
  deps: HandlerDeps,
  context: HandlerContext,
): RunFinishedContext | null {
  const { db, logger } = deps;
  const { leaseRenewalMap } = context;

  let run: RunRecord;
  try {
    run = db.getRun(event.runId);
  } catch (error) {
    logger.warn(
      `[finalizeRun] getRun(${event.runId}) failed; run may have been deleted: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }

  persistRunEvent(db, logger, {
    companyId: run.companyId,
    runId: run.id,
    agentId: run.agentId,
    eventType: "run_finished",
    level: event.status === "succeeded" ? "info" : "error",
    message: event.summary ?? event.errorMessage ?? event.status,
    payload: {
      status: event.status,
      summary: event.summary,
      errorMessage: event.errorMessage,
      exitCode: event.exitCode,
      signal: event.signal,
      model: event.model,
      unattributedCost: event.unattributedCost,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
    },
  });

  let task: TaskRecord | null = null;
  if (run.taskId) {
    try {
      task = db.getTask(run.taskId);
    } catch (error) {
      logger.warn(
        `[finalizeRun] getTask(${run.taskId}) failed; task may have been deleted: ${error instanceof Error ? error.message : String(error)}`,
      );
      task = null;
    }
  }

  leaseRenewalMap.delete(event.runId);
  const runOutcome = db.finishRun(event);
  if (run.workspaceId) {
    db.releaseWorkspaceLock(run.workspaceId, run.id);
  }
  db.addActivity({
    companyId: run.companyId,
    actor: run.agentId,
    action: `run.${event.status}`,
    entityType: "run",
    entityId: run.id,
    detail: event.summary ?? event.errorMessage ?? "",
  });

  return { run, task, runOutcome };
}

export function accumulateAndRotateSession(
  event: RunFinishedEvent,
  deps: HandlerDeps,
  rfCtx: RunFinishedContext,
): void {
  const { db, logger, sessionService } = deps;
  const { run } = rfCtx;

  if (!sessionService) return;

  // Sessions are agent-scoped (post-v34 migration). The previous gate on
  // `!task` silently dropped token accumulation and rotation for every
  // heartbeat run — the exact failure mode that lets a taskless transcript
  // grow past the model's context window. Resolve the session through the
  // agent, never through the task.
  let agentRecord: ReturnType<HandlerDeps["db"]["getAgent"]>;
  try {
    agentRecord = db.getAgent(run.agentId);
  } catch (error) {
    logger.warn(
      `[session] accumulateAndRotateSession: getAgent(${run.agentId}) failed; skipping: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }
  if (!agentRecord.sessionId) return;
  const session = db.getSessionById(agentRecord.sessionId);
  if (!session) return;

  sessionService.accumulateTokenUsage(
    session.id,
    event.inputTokens ?? 0,
    event.outputTokens ?? 0,
    event.runId,
  );
  // Re-read after accumulation: evaluateRotation must see the counts
  // that include this run, otherwise a run that just crossed the
  // threshold waits a full additional cycle to rotate — the exact
  // failure mode that let transcripts balloon past the context window.
  const updatedSession = db.getSessionById(agentRecord.sessionId);
  if (!updatedSession) return;
  const rotationResult = sessionService.evaluateRotation(updatedSession);
  if (rotationResult.shouldRotate) {
    sessionService.rotateSession(updatedSession);
    logger.info(`[session] Rotated session for agent ${run.agentId}: ${rotationResult.reason}`);
  }
}

export function emitAndNotifyCompletion(
  event: RunFinishedEvent,
  deps: HandlerDeps,
  rfCtx: RunFinishedContext,
): void {
  const { db, emitEvent, notify, logger } = deps;
  const { run, task, runOutcome } = rfCtx;

  emitEvent({ type: "run-updated", runId: run.id, action: "completed" });
  emitEvent({
    type: "run-status",
    runId: run.id,
    status: event.status,
    message: event.summary ?? event.errorMessage ?? event.status,
  });
  if ((event.status === "failed" || event.status === "timed_out" || event.status === "interrupted") && task) {
    notify({
      title: "Task Failed",
      body: `${task.title} -- manual intervention needed`,
      urgency: "informational",
      navigation: { section: "tasks", entityId: task.id },
      batchKey: "failed_runs",
    });
  }

  let updatedAgent: ReturnType<HandlerDeps["db"]["getAgent"]> | null = null;
  try {
    updatedAgent = db.getAgent(run.agentId);
  } catch (error) {
    logger.warn(
      `[emitAndNotifyCompletion] getAgent(${run.agentId}) failed; skipping budget-paused notification: ${error instanceof Error ? error.message : String(error)}`,
    );
    updatedAgent = null;
  }

  if (updatedAgent && runOutcome.budgetHardStopped) {
    db.addActivity({
      companyId: updatedAgent.companyId,
      actor: "system",
      action: "agent.auto_paused",
      entityType: "agent",
      entityId: updatedAgent.id,
      detail: `Budget exhausted at ${updatedAgent.spentMonthlyUsd.toFixed(2)} / ${updatedAgent.budgetMonthlyUsd.toFixed(2)} USD.`,
    });
    notify({
      title: "Agent Paused",
      body: `${updatedAgent.name} paused -- budget limit reached`,
      urgency: "informational",
      navigation: { section: "agents", entityId: updatedAgent.id },
      batchKey: "agent_paused",
    });
    emitEvent({ type: "agent-updated", agentId: updatedAgent.id, action: "paused" });
  }
}

export function runPostCompletionAutomation(
  event: RunFinishedEvent,
  deps: HandlerDeps,
  context: HandlerContext,
  rfCtx: RunFinishedContext,
): { hadDeferredWakes: boolean } {
  const { db, logger, isQuitting, wakeAgentIfPossible, processRunCompletion, onRunCompleted, notify, budgetService } = deps;
  const { destroyed, MAX_RETRY_ATTEMPTS, RETRY_COOLDOWN_MS, pendingRetryTimers } = context;
  const { run, task } = rfCtx;

  // Policy-based incident check after run completion. Always runs once the
  // run is finalized — cost is read from the cost_entries SUM inside
  // finishRun/checkAndCreateIncidents, not from the worker event.
  if (budgetService && event.status === "succeeded") {
    budgetService.checkAndCreateIncidents(run.companyId, run.agentId, task?.projectId ?? null);
  }

  if ((event.status === "failed" || event.status === "timed_out") && !isQuitting() && !destroyed && run.taskId) {
    handleFailureEscalation(
      {
        db,
        wakeAgentIfPossible,
        notify: (title, body) =>
          notify({ title, body, urgency: "critical", navigation: { section: "tasks", entityId: run.taskId ?? "" } }),
        logger,
      },
      { taskId: run.taskId, agentId: run.agentId, companyId: run.companyId },
      task,
      event.status,
      MAX_RETRY_ATTEMPTS,
      RETRY_COOLDOWN_MS,
      (fn, delayMs) => {
        const retryTimer = setTimeout(() => {
          pendingRetryTimers.delete(retryTimer);
          if (isQuitting() || destroyed) return;
          fn();
        }, delayMs);
        pendingRetryTimers.add(retryTimer);
      },
    );
  }

  // EXEC-05: Promote deferred wakes after run completion
  let hadDeferredWakes = false;
  if (!isQuitting() && !destroyed) {
    const promoted = db.promoteWakeupRequests(run.agentId, run.companyId);
    const pendingWakeTrigger = db.getPreferredWakeTrigger(run.agentId, run.companyId);
    if (promoted > 0) {
      logger.info(`[worker] Promoted ${promoted} deferred wake(s) for agent ${run.agentId}`);
    }
    if (pendingWakeTrigger) {
      hadDeferredWakes = true;
      logger.info(
        `[worker] Processing pending wake(s) for agent ${run.agentId} with priority trigger "${pendingWakeTrigger}"`,
      );
      wakeAgentIfPossible(run.agentId, run.companyId, pendingWakeTrigger);
    }
  }

  if (!isQuitting() && !destroyed) {
    processRunCompletion(run, event as z.infer<typeof workerMessageSchema> & { type: "run-finished" });
  }

  // Run housekeeping: thread events + knowledge candidates
  if (!isQuitting() && !destroyed) {
    try {
      onRunCompleted?.(
        run.id,
        run.taskId,
        run.agentId,
        run.companyId,
        event.status,
        event.summary ?? null,
        event.errorMessage ?? null,
      );
    } catch (err) {
      logger.error(`[worker] onRunCompleted housekeeping failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Reset retry count on successful completion
  if (event.status === "succeeded" && run.taskId) {
    handleSuccessReset(db, run.taskId, logger);
  }

  return { hadDeferredWakes };
}

export function triggerSelfWake(
  event: RunFinishedEvent,
  deps: HandlerDeps,
  context: HandlerContext,
  rfCtx: RunFinishedContext,
  hadDeferredWakes: boolean,
): void {
  const { db, logger, isQuitting, wakeAgentIfPossible } = deps;
  const { destroyed, consecutiveWakeMap, MAX_CONSECUTIVE_WAKES } = context;
  const { run } = rfCtx;

  const cb = createCircuitBreaker(consecutiveWakeMap, MAX_CONSECUTIVE_WAKES);

  // Reset circuit breaker when a task actually progressed (successful run)
  if (event.status === "succeeded") {
    cb.reset(run.agentId, run.companyId);
  }

  // Self-wake with circuit breaker to prevent infinite loops
  if (hadDeferredWakes || isQuitting() || destroyed) return;

  try {
    const actionableTasks = db.listAgentTasks(run.agentId, run.companyId, ["todo", "in_progress"]);
    const hasWorkToContinue = actionableTasks.length > 0 || hasUnfinishedTeamBuilding(db, run.agentId, run.companyId);
    if (!hasWorkToContinue) return;

    const allowed = cb.tryWake(run.agentId, run.companyId);
    if (!allowed) {
      logger.warn(
        `[self-wake] Circuit breaker: agent ${run.agentId} has self-woken ${MAX_CONSECUTIVE_WAKES} times without progress. Pausing self-wake.`,
      );
      // Escalate to manager since agent is stuck
      try {
        const chain = db.getChainOfCommand(run.agentId);
        if (chain.length > 0) {
          wakeAgentIfPossible(chain[0].id, run.companyId, "report_stuck");
        }
      } catch (error) {
        logger.warn(
          `[self-wake] chain-of-command lookup failed for agent ${run.agentId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else {
      wakeAgentIfPossible(run.agentId, run.companyId, "task_continuation");
    }
  } catch (error) {
    logger.warn(
      `[self-wake] self-wake evaluation failed for agent ${run.agentId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Returns true when a top-level agent (CEO) still has team-building work
 * in flight: the company has an active goal, zero active direct reports,
 * and no pending hire approvals. Each wake in that window files at most a
 * handful of hire_agent POSTs, so chaining runs via self-wake instead of
 * waiting for the 2-minute heartbeat timer takes bootstrap from
 * 10-plus minutes down to the LLM's round-trip time.
 *
 * The circuit breaker on the caller side still applies, so a CEO that
 * keeps completing runs without actually creating hires gets paused
 * after MAX_CONSECUTIVE_WAKES attempts.
 */
function hasUnfinishedTeamBuilding(
  db: HandlerDeps["db"],
  agentId: string,
  companyId: string,
): boolean {
  try {
    const agent = db.getAgent(agentId);
    if (agent.reportsTo !== null) return false;
    const activeReports = db
      .getDirectReports(agentId, companyId)
      .filter((r) => r.status !== "pending_approval" && r.status !== "terminated");
    if (activeReports.length > 0) return false;
    const goalCount = db.countActiveGoalsForCompany(companyId);
    if (goalCount === 0) return false;
    const pendingHires = db
      .listCompanyApprovalsByType(companyId, "hire_agent")
      .filter((a) => a.state === "pending");
    return pendingHires.length === 0;
  } catch {
    return false;
  }
}
