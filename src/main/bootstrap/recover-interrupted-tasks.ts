import type { AppDatabase } from "../database";
import type { DesktopEvent } from "@shared/types";
import type { NotificationOptions } from "../notification-service";

interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

export interface RecoverInterruptedTasksDeps {
  db: AppDatabase;
  logger: Logger;
  emitEvent: (event: DesktopEvent) => void;
  notify: (options: NotificationOptions) => void;
  publishDomainChanged: () => void;
  wakeAgentIfPossible: (agentId: string | null | undefined, companyId: string, trigger: string) => string | null;
}

/** Emit the session-recovery notification for runs interrupted by crash. */
export function emitCrashRecoveryNotification(deps: RecoverInterruptedTasksDeps): void {
  const interruptedCount = deps.db.lastInterruptedCount;
  if (interruptedCount <= 0) return;
  deps.logger.warn(`[bootstrap] Detected ${interruptedCount} interrupted runs from previous session. Sending recovery notification.`);
  const interruptedRuns = deps.db.getInterruptedRunsForRecovery();
  if (interruptedRuns.length === 0) return;
  deps.emitEvent({ type: "recovery-needed", interruptedRuns });
  deps.notify({
    title: "Session Recovered",
    body: `${interruptedRuns.length} interrupted task(s) detected from previous session`,
    urgency: "informational",
    navigation: { section: "overview" },
  });
}

/**
 * Resume tasks interrupted by a clean shutdown. worker-service marks running/
 * queued runs as `interrupted` on destroy but does not reset the tasks; without
 * this recovery the assigned agents never re-wake to continue them.
 */
export function recoverShutdownInterruptedTasks(deps: RecoverInterruptedTasksDeps): void {
  try {
    const snapshot = deps.db.listSnapshot();
    const shutdownRuns = snapshot.runs.filter(
      (r) => r.status === "interrupted" &&
        (r.summary === "Application shut down." || r.summary === "Worker process crashed."),
    );
    if (shutdownRuns.length === 0) return;
    const resumedAgents = new Set<string>();
    for (const run of shutdownRuns) {
      try {
        if (run.taskId) {
          const task = deps.db.entityCrud.getTask(run.taskId);
          if (task.status === "in_progress" || task.status === "blocked") {
            deps.db.tasks.advanceTaskStatus(run.taskId, "todo", "Auto-resumed after app restart.");
            deps.db.tasks.releaseTaskLock(run.taskId, run.id);
          }
        }
        if (!resumedAgents.has(run.agentId)) {
          resumedAgents.add(run.agentId);
          deps.wakeAgentIfPossible(run.agentId, run.companyId, "app_restart_resume");
        }
      } catch (error) {
        deps.logger.warn(`[bootstrap] Skipped shutdown recovery for run ${run.id} (task/agent may have been deleted):`, error);
      }
    }
    if (resumedAgents.size > 0) {
      deps.logger.info(`[bootstrap] Resumed ${shutdownRuns.length} interrupted task(s) across ${resumedAgents.size} agent(s) after clean shutdown recovery.`);
      deps.publishDomainChanged();
    }
  } catch (err) {
    deps.logger.warn(`[bootstrap] Shutdown recovery failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
