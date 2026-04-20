import type { OrchestrationDependencies } from "./types";

export function createLockRecoveryScheduler(deps: OrchestrationDependencies) {
  const { db, logger, publishDomainChanged, hasWorkerReady, isQuitting } = deps;

  let timer: ReturnType<typeof setInterval> | null = null;

  function start() {
    if (timer) clearInterval(timer);

    timer = setInterval(() => {
      try {
        if (isQuitting() || !hasWorkerReady()) return;

        // D-02: Stale lock recovery (EXEC-03)
        try {
          const recovered = db.recoverStaleLocks();
          for (const task of recovered) {
            db.activityMod.addActivity({
              companyId: task.companyId,
              actor: "system",
              action: "execution.lock_recovered",
              entityType: "task",
              entityId: task.taskId,
              detail: `Recovered stale lock on task "${task.title}" after 15min timeout`,
            });
            logger.info(`[lock-recovery] Recovered stale lock on task ${task.taskId}: "${task.title}"`);
          }
        } catch (err) {
          logger.error(`[lock-recovery] Stale lock recovery failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        try {
          const staleReleased = db.workspacesMod.releaseStaleWorkspaceLocks();
          if (staleReleased > 0) {
            logger.info(`[lock-recovery] Released ${staleReleased} stale workspace lock(s)`);
            publishDomainChanged();
          }
        } catch (error) {
          logger.error(`[lock-recovery] Stale workspace lock cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      } catch (error) {
        logger.error(`[lock-recovery] Scheduler error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, 60_000);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop };
}
