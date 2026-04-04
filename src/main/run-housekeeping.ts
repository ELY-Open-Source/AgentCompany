import type { AppDatabase } from "./database";
import type { ThreadIntegrationService } from "./thread-integration";

interface RunHousekeepingDeps {
  db: AppDatabase;
  logger: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  threadIntegration: ThreadIntegrationService;
}

export function createRunHousekeeping({ db, logger, threadIntegration }: RunHousekeepingDeps) {
  return {
    onRunCompleted(
      runId: string,
      taskId: string,
      agentId: string,
      companyId: string,
      status: string,
      summary: string | null,
      errorMessage: string | null,
    ): void {
      // 1. Record run completion in the task thread
      try {
        threadIntegration.onRunFinished(runId, taskId, agentId, companyId, status, errorMessage ?? null);
      } catch (err) {
        logger.error(`[run-housekeeping] threadIntegration.onRunFinished failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      // 2. On success with a meaningful summary, create a knowledge candidate
      if (status === "succeeded" && summary && summary.length > 50) {
        try {
          let topic = `Run ${runId.slice(0, 8)}`;
          try {
            const task = db.getTask(taskId);
            topic = task.title;
          } catch { /* task may have been deleted */ }

          db.saveKnowledgeEntry({
            companyId,
            category: "lesson_learned",
            topic,
            content: summary,
            authorAgentId: agentId,
          });
          logger.info(`[run-housekeeping] Knowledge candidate created for run ${runId} (task: ${topic})`);
        } catch (err) {
          logger.error(`[run-housekeeping] saveKnowledgeEntry failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // 3. On failure, record an activity log entry
      if (status === "failed") {
        try {
          db.addActivity({
            companyId,
            actor: agentId,
            action: "run.failed",
            entityType: "run",
            entityId: runId,
            detail: errorMessage ?? summary ?? "Run failed without details.",
          });
        } catch (err) {
          logger.error(`[run-housekeeping] addActivity (failure) failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    },
  };
}

export type RunHousekeepingService = ReturnType<typeof createRunHousekeeping>;
