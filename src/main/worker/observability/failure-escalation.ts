/**
 * Retry-aware failure escalation pipeline.
 *
 * State machine:
 *   1. Task fails with retry_count < MAX_RETRY_ATTEMPTS  -> increment count, re-queue
 *   2. Task fails with retry_count >= MAX_RETRY_ATTEMPTS -> escalate to manager chain
 *   3. No manager in chain                               -> fall through to CEO
 *   4. No CEO available                                  -> notify user
 *   5. Task succeeds                                     -> reset retry count
 */

export interface EscalationDeps {
  db: {
    getTaskRetryCount: (taskId: string) => number;
    incrementTaskRetryCount: (taskId: string) => void;
    resetTaskRetryCount: (taskId: string) => void;
    getChainOfCommand: (agentId: string) => Array<{ id: string; name: string }>;
    getCeoForCompany: (companyId: string) => { id: string; name: string } | null;
    advanceTaskStatus: (taskId: string, status: string, note: string) => unknown;
  };
  wakeAgentIfPossible: (agentId: string, companyId: string, trigger: string) => unknown;
  notify: (title: string, body: string) => void;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

export interface EscalationResult {
  action: "retry" | "escalated" | "user_notified" | "none";
  retryScheduled?: boolean;
}

export function handleFailureEscalation(
  deps: EscalationDeps,
  run: { taskId: string; agentId: string; companyId: string },
  task: { title: string } | null,
  eventStatus: "failed" | "timed_out",
  maxRetryAttempts: number,
  retryCooldownMs: number,
  scheduleRetry: (fn: () => void, delayMs: number) => void,
): EscalationResult {
  const { db, wakeAgentIfPossible, notify, logger } = deps;
  const retryCount = db.getTaskRetryCount(run.taskId);

  if (retryCount < maxRetryAttempts) {
    db.incrementTaskRetryCount(run.taskId);
    db.advanceTaskStatus(
      run.taskId,
      "todo",
      `Run ${eventStatus} (attempt ${retryCount + 1}/${maxRetryAttempts}). Auto-retrying after ${retryCooldownMs / 1000}s cooldown.`,
    );
    logger.info(
      `[escalation] Retrying task ${run.taskId} (attempt ${retryCount + 1}/${maxRetryAttempts}) for agent ${run.agentId}`,
    );
    scheduleRetry(() => {
      wakeAgentIfPossible(run.agentId, run.companyId, "retry_failed");
    }, retryCooldownMs);
    return { action: "retry", retryScheduled: true };
  }

  // Retry limit reached — escalate up the chain
  db.resetTaskRetryCount(run.taskId);
  logger.warn(
    `[escalation] Task ${run.taskId} failed ${maxRetryAttempts} times. Escalating to manager.`,
  );

  let escalated = false;
  try {
    const chain = db.getChainOfCommand(run.agentId);
    if (chain.length > 0) {
      wakeAgentIfPossible(chain[0].id, run.companyId, "report_failed");
      escalated = true;
      logger.info(
        `[escalation] Escalated task ${run.taskId} to manager ${chain[0].name} (${chain[0].id})`,
      );
    }
  } catch (error) {
    logger.warn(
      `[escalation] Chain-of-command lookup failed for agent ${run.agentId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!escalated) {
    try {
      const ceo = db.getCeoForCompany(run.companyId);
      if (ceo) {
        wakeAgentIfPossible(ceo.id, run.companyId, "report_failed");
        escalated = true;
        logger.info(
          `[escalation] Escalated task ${run.taskId} to CEO ${ceo.name} (${ceo.id})`,
        );
      }
    } catch (error) {
      logger.warn(
        `[escalation] CEO lookup failed for company ${run.companyId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (!escalated) {
    const taskTitle = task?.title ?? run.taskId;
    notify(
      "Task failed -- manual intervention needed",
      `"${taskTitle}" failed ${maxRetryAttempts} times and no manager is available to handle it.`,
    );
    logger.error(
      `[escalation] Task ${run.taskId} failed with no escalation target. User notified.`,
    );
    return { action: "user_notified" };
  }

  return { action: "escalated" };
}

export function handleSuccessReset(
  db: EscalationDeps["db"],
  taskId: string,
  logger?: EscalationDeps["logger"],
): void {
  try {
    db.resetTaskRetryCount(taskId);
  } catch (error) {
    logger?.warn(
      `[escalation] resetTaskRetryCount failed for task ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
