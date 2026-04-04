import { z } from "zod";
import { getConnectorDefinition } from "../connectors";
import type { WorkerServiceDependencies, workerMessageSchema } from "./worker-types";

const LEASE_RENEWAL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function persistRunEvent(
  db: WorkerServiceDependencies["db"],
  logger: WorkerServiceDependencies["logger"],
  input: {
    companyId: string;
    runId: string;
    agentId: string;
    eventType: string;
    stream?: "stdout" | "stderr" | null;
    level?: string | null;
    message?: string | null;
    payload?: Record<string, unknown> | null;
  },
) {
  try {
    db.appendRunEvent(input);
  } catch (error) {
    logger.warn(`[run-events] Failed to append ${input.eventType} for ${input.runId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function handleWorkerMessage(
  message: unknown,
  worker: ReturnType<typeof import("electron").utilityProcess.fork> | null,
  {
    db,
    logger,
    isQuitting,
    emitEvent,
    wakeAgentIfPossible,
    processRunCompletion,
    onRunStarted,
    onRunCompleted,
    notify,
    budgetService,
    sessionService,
  }: Pick<WorkerServiceDependencies, "db" | "logger" | "isQuitting" | "emitEvent" | "wakeAgentIfPossible" | "processRunCompletion" | "onRunStarted" | "onRunCompleted" | "notify" | "budgetService" | "sessionService">,
  workerMessageSchemaRef: typeof workerMessageSchema,
  destroyed: boolean,
  MAX_RETRY_ATTEMPTS: number,
  RETRY_COOLDOWN_MS: number,
  consecutiveWakeMap: Map<string, number>,
  MAX_CONSECUTIVE_WAKES: number,
  pendingRetryTimers: Set<ReturnType<typeof setTimeout>>,
  leaseRenewalMap: Map<string, number>,
) {
  let event: z.infer<typeof workerMessageSchemaRef>;
  try {
    event = workerMessageSchemaRef.parse(message);
  } catch (error) {
    logger.error("[worker] invalid message payload", error);
    return;
  }

  if (event.type === "run-log") {
    await db.appendRunLog(event.runId, event.stream, event.chunk);
    const runState = db.getRunAuthState(event.runId);
    if (runState) {
      persistRunEvent(db, logger, {
        companyId: runState.companyId,
        runId: event.runId,
        agentId: runState.agentId,
        eventType: "run_log",
        stream: event.stream,
        message: event.chunk,
      });
    }
    emitEvent(event);

    // Throttled lease renewal: keep execution lock alive for long-running tasks.
    // Without this, tasks exceeding the 15-minute stale lock timeout get reclaimed.
    const now = Date.now();
    const lastRenewal = leaseRenewalMap.get(event.runId) ?? 0;
    if (now - lastRenewal >= LEASE_RENEWAL_INTERVAL_MS) {
      const run = db.listSnapshot().runs.find((r) => r.id === event.runId);
      if (run) {
        db.renewTaskLease(run.taskId, run.id);
        leaseRenewalMap.set(event.runId, now);
      }
    }
    return;
  }

  if (event.type === "run-status") {
    const runState = db.getRunAuthState(event.runId);
    db.markRunStatus(event.runId, event.status, event.message);
    if (runState) {
      persistRunEvent(db, logger, {
        companyId: runState.companyId,
        runId: event.runId,
        agentId: runState.agentId,
        eventType: "run_status",
        level: event.status === "failed" || event.status === "timed_out" || event.status === "interrupted" ? "error" : "info",
        message: event.message,
        payload: { status: event.status },
      });
    }
    if (event.status === "running") {
      const run = db.listSnapshot().runs.find((entry) => entry.id === event.runId);
      if (run?.workspaceId && !db.claimWorkspaceLock(run.workspaceId, run.id)) {
        logger.error(`[workspace] Failed to claim lock for workspace ${run.workspaceId} when run ${run.id} entered running state. Cancelling run.`);
        worker?.postMessage({ type: "cancel-run", runId: run.id });
      }
      if (run) {
        db.renewTaskLease(run.taskId, run.id);
        onRunStarted?.(run.id, run.taskId, run.agentId, run.companyId);
      }
    }
    emitEvent(event);
    emitEvent({ type: "run-updated", runId: event.runId, action: "status_changed" });
    return;
  }

  const snapshot = db.listSnapshot();
  const run = snapshot.runs.find((entry) => entry.id === event.runId);
  if (!run) {
    return;
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
      sessionDisplayId: event.sessionDisplayId,
      costUsd: event.costUsd,
      unattributedCost: event.unattributedCost,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
    },
  });

  const connector = getConnectorDefinition(run.connectorId);

  let task: ReturnType<typeof db["getTask"]> | null = null;
  try {
    task = db.getTask(run.taskId);
  } catch {
    task = null;
  }

  if (task) {
    if (event.sessionParams && connector.module.sessionCodec) {
      const serialized = connector.module.sessionCodec.serialize(event.sessionParams);
      db.updateTaskSession(task.id, serialized, connector.module.sessionCodec.getDisplayId?.(serialized ?? null) ?? event.sessionDisplayId ?? null);
    }
    if (!event.sessionParams) {
      db.updateTaskSession(task.id, null, null);
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

  // SESS-01/SESS-02/SESS-03/SESS-05: Token accumulation and rotation evaluation
  if (task && sessionService) {
    const activeSession = db.getActiveTaskSession(task.id);
    if (activeSession) {
      // D-08/D-05: Accumulate token usage for ALL adapters (including exempt ones)
      sessionService.accumulateTokenUsage(
        activeSession.id,
        event.inputTokens ?? 0,
        event.outputTokens ?? 0,
        event.runId,
      );
      // D-03: Evaluate rotation after accumulation (after each run completes)
      const rotationResult = sessionService.evaluateRotation(activeSession, run.connectorId);
      if (rotationResult.shouldRotate) {
        // Re-read to get updated counts after accumulation
        const updatedSession = db.getActiveTaskSession(task.id);
        if (updatedSession) {
          sessionService.rotateSession(updatedSession);
          logger.info(`[session] Rotated session for task ${task.id}: ${rotationResult.reason}`);
        }
      }
    }
  }

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

  let updatedAgent: ReturnType<typeof db["getAgent"]> | null = null;
  try {
    updatedAgent = db.getAgent(run.agentId);
  } catch {
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

  // Policy-based incident check after run completion (Phase 5)
  if (budgetService && typeof event.costUsd === "number" && Number.isFinite(event.costUsd)) {
    try {
      const taskForBudget = db.getTask(run.taskId);
      budgetService.checkAndCreateIncidents(run.companyId, run.agentId, taskForBudget?.projectId ?? null);
    } catch (err) {
      logger.error(`[budget] Incident check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if ((event.status === "failed" || event.status === "timed_out") && !isQuitting() && !destroyed) {
    const retryCount = db.getTaskRetryCount(run.taskId);

    if (retryCount < MAX_RETRY_ATTEMPTS) {
      // Retry same agent after cooldown
      db.incrementTaskRetryCount(run.taskId);
      db.advanceTaskStatus(run.taskId, "todo",
        `Run ${event.status} (attempt ${retryCount + 1}/${MAX_RETRY_ATTEMPTS}). Auto-retrying after ${RETRY_COOLDOWN_MS / 1000}s cooldown.`);
      logger.info(`[escalation] Retrying task ${run.taskId} (attempt ${retryCount + 1}/${MAX_RETRY_ATTEMPTS}) for agent ${run.agentId}`);
      const retryTimer = setTimeout(() => {
        pendingRetryTimers.delete(retryTimer);
        if (isQuitting() || destroyed) return;
        wakeAgentIfPossible(run.agentId, run.companyId, "retry_failed");
      }, RETRY_COOLDOWN_MS);
      pendingRetryTimers.add(retryTimer);
    } else {
      // Retry limit reached -- escalate up the chain
      db.resetTaskRetryCount(run.taskId);
      logger.warn(`[escalation] Task ${run.taskId} failed ${MAX_RETRY_ATTEMPTS} times. Escalating to manager.`);

      let escalated = false;
      try {
        const chain = db.getChainOfCommand(run.agentId);
        if (chain.length > 0) {
          wakeAgentIfPossible(chain[0].id, run.companyId, "report_failed");
          escalated = true;
          logger.info(`[escalation] Escalated task ${run.taskId} to manager ${chain[0].name} (${chain[0].id})`);
        }
      } catch {
        // Chain lookup failed (agent deleted)
      }

      if (!escalated) {
        // No manager found -- try CEO
        try {
          const ceo = db.getCeoForCompany(run.companyId);
          if (ceo) {
            wakeAgentIfPossible(ceo.id, run.companyId, "report_failed");
            escalated = true;
            logger.info(`[escalation] Escalated task ${run.taskId} to CEO ${ceo.name} (${ceo.id})`);
          }
        } catch { /* CEO lookup failed */ }
      }

      if (!escalated) {
        // No one to escalate to -- notify user
        const taskTitle = task?.title ?? run.taskId;
        notify({
          title: "Attention Required",
          body: `${taskTitle} needs manual intervention`,
          urgency: "critical",
          navigation: { section: "tasks", entityId: run.taskId },
        });
        logger.error(`[escalation] Task ${run.taskId} failed with no escalation target. User notified.`);
      }
    }
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
      logger.info(`[worker] Processing pending wake(s) for agent ${run.agentId} with priority trigger "${pendingWakeTrigger}"`);
      wakeAgentIfPossible(run.agentId, run.companyId, pendingWakeTrigger);
    }
  }

  if (!isQuitting() && !destroyed) {
    processRunCompletion(run, event as z.infer<typeof workerMessageSchemaRef> & { type: "run-finished" });
  }

  // Run housekeeping: thread events + knowledge candidates
  if (!isQuitting() && !destroyed) {
    try {
      onRunCompleted?.(run.id, run.taskId, run.agentId, run.companyId, event.status, event.summary ?? null, event.errorMessage ?? null);
    } catch (err) {
      logger.error(`[worker] onRunCompleted housekeeping failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Reset retry count on successful completion
  if (event.status === "succeeded") {
    try { db.resetTaskRetryCount(run.taskId); } catch { /* best effort */ }
  }

  // Reset circuit breaker when a task actually progressed (successful run)
  if (event.status === "succeeded") {
    const wakeKey = `${run.agentId}:${run.companyId}`;
    consecutiveWakeMap.delete(wakeKey);
  }

  // Self-wake with circuit breaker to prevent infinite loops
  if (!hadDeferredWakes && !isQuitting() && !destroyed) {
    try {
      const actionableTasks = db.listAgentTasks(run.agentId, run.companyId, ["todo", "in_progress"]);
      if (actionableTasks.length > 0) {
        const wakeKey = `${run.agentId}:${run.companyId}`;
        const consecutiveCount = consecutiveWakeMap.get(wakeKey) ?? 0;

        if (consecutiveCount >= MAX_CONSECUTIVE_WAKES) {
          logger.warn(`[self-wake] Circuit breaker: agent ${run.agentId} has self-woken ${consecutiveCount} times without progress. Pausing self-wake.`);
          consecutiveWakeMap.delete(wakeKey);
          // Escalate to manager since agent is stuck
          try {
            const chain = db.getChainOfCommand(run.agentId);
            if (chain.length > 0) {
              wakeAgentIfPossible(chain[0].id, run.companyId, "report_stuck");
            }
          } catch { /* best effort */ }
        } else {
          consecutiveWakeMap.set(wakeKey, consecutiveCount + 1);
          wakeAgentIfPossible(run.agentId, run.companyId, "task_continuation");
        }
      }
    } catch {
      // Best-effort self-wake; agent will pick up work on the next heartbeat cycle.
    }
  }
}
