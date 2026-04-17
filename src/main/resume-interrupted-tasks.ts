import type log from "electron-log/main.js";
import type { AppDatabase } from "./database";

interface ResumeInterruptedTasksDeps {
  db: AppDatabase;
  logger: typeof log;
  wakeAgentIfPossible: (agentId: string, companyId: string, trigger: string) => string | null;
  publishDomainChanged: () => void;
}

/**
 * Resume tasks that were left behind by a clean shutdown.
 *
 * The worker-service marks running/queued runs as "interrupted" with a fixed
 * summary string on shutdown, but does not reset the owning task. This helper
 * rolls those tasks back to "todo", releases their run locks, and re-wakes the
 * assigned agents so heartbeat can pick them up again.
 */
export function resumeInterruptedTasks({
  db,
  logger,
  wakeAgentIfPossible,
  publishDomainChanged,
}: ResumeInterruptedTasksDeps): void {
  try {
    const snapshot = db.listSnapshot();
    const shutdownRuns = snapshot.runs.filter(
      (r) =>
        r.status === "interrupted" &&
        (r.summary === "Application shut down." || r.summary === "Worker process crashed."),
    );
    if (shutdownRuns.length === 0) return;

    const resumedAgents = new Set<string>();
    for (const run of shutdownRuns) {
      try {
        const task = db.getTask(run.taskId);
        if (task.status === "in_progress" || task.status === "blocked") {
          db.advanceTaskStatus(run.taskId, "todo", "Auto-resumed after app restart.");
          db.releaseTaskLock(run.taskId, run.id);
        }
        if (!resumedAgents.has(run.agentId)) {
          resumedAgents.add(run.agentId);
          wakeAgentIfPossible(run.agentId, run.companyId, "app_restart_resume");
        }
      } catch (error) {
        logger.warn(
          `[bootstrap] Skipped shutdown recovery for run ${run.id} (task/agent may have been deleted):`,
          error,
        );
      }
    }

    if (resumedAgents.size > 0) {
      logger.info(
        `[bootstrap] Resumed ${shutdownRuns.length} interrupted task(s) across ${resumedAgents.size} agent(s) after clean shutdown recovery.`,
      );
      publishDomainChanged();
    }
  } catch (err) {
    logger.warn(
      `[bootstrap] Shutdown recovery failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
