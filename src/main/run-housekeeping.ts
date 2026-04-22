import type { AppDatabase } from "./database";
import type { ThreadIntegrationService } from "./thread-integration";

interface RunHousekeepingDeps {
  db: AppDatabase;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  threadIntegration: ThreadIntegrationService;
}

/**
 * Task types whose successful runs produce durable lessons worth capturing
 * into the knowledge base. Ad-hoc code tasks, chores, and one-off ops
 * produce runtime noise that pollutes the knowledge table if auto-saved.
 */
const KNOWLEDGE_PRODUCING_TASK_TYPES: ReadonlySet<string> = new Set([
  "research",
  "analysis",
  "planning",
  "strategy",
  "review",
]);

/**
 * Agent departments whose output is routinely curated as corporate
 * knowledge regardless of task type.
 */
const KNOWLEDGE_PRODUCING_DEPARTMENTS: ReadonlySet<string> = new Set([
  "research",
  "strategy",
  "management",
]);

function shouldProduceKnowledge(
  db: AppDatabase,
  taskId: string,
  agentId: string,
  logger: RunHousekeepingDeps["logger"],
): boolean {
  try {
    const taskTypeRow = db.queryAll<{ taskType: string | null }>(
      "SELECT task_type as taskType FROM tasks WHERE id = ? LIMIT 1",
      taskId,
    )[0];
    if (taskTypeRow?.taskType && KNOWLEDGE_PRODUCING_TASK_TYPES.has(taskTypeRow.taskType)) {
      return true;
    }
  } catch (error) {
    logger.warn(
      `[run-housekeeping] task lookup failed for ${taskId}; falling back to agent department check: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    const agent = db.core.entity.getAgent(agentId);
    return Boolean(agent.department && KNOWLEDGE_PRODUCING_DEPARTMENTS.has(agent.department));
  } catch (error) {
    logger.warn(
      `[run-housekeeping] agent lookup failed for ${agentId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

export function createRunHousekeeping({ db, logger, threadIntegration }: RunHousekeepingDeps) {
  return {
    onRunCompleted(
      runId: string,
      taskId: string | null,
      agentId: string,
      companyId: string,
      status: string,
      summary: string | null,
      errorMessage: string | null,
    ): void {
      // Skip thread integration + knowledge candidates for heartbeat runs
      // (no task to attach them to).
      if (!taskId) return;
      // 1. Record run completion in the task thread
      try {
        threadIntegration.onRunFinished(runId, taskId, agentId, companyId, status, errorMessage ?? null);
      } catch (err) {
        logger.error(`[run-housekeeping] threadIntegration.onRunFinished failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      // 2. On success with a meaningful summary, create a knowledge candidate —
      //    gated on the task type or the producing agent's department so
      //    ad-hoc runs do not flood the knowledge table with summaries.
      if (
        status === "succeeded" &&
        summary &&
        summary.length > 50 &&
        shouldProduceKnowledge(db, taskId, agentId, logger)
      ) {
        try {
          let topic = `Run ${runId.slice(0, 8)}`;
          try {
            const task = db.core.entity.getTask(taskId);
            topic = task.title;
          } catch (error) {
            logger.warn(
              `[run-housekeeping] getTask failed for ${taskId}; using run id as topic: ${error instanceof Error ? error.message : String(error)}`,
            );
          }

          db.core.knowledge.saveKnowledgeEntry({
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
          db.core.activity.addActivity({
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
