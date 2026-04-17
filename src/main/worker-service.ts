import { app, utilityProcess } from "electron";
import { workerMessageSchema, type WorkerServiceDependencies } from "./worker/worker-types";
import { handleWorkerExit } from "./worker/worker-crash-recovery";
import { handleWorkerMessage } from "./worker/worker-message-handler";

export { workerMessageSchema } from "./worker/worker-types";

export function createWorkerService({
  db,
  logger,
  workerPath,
  isQuitting,
  publishDomainChanged,
  emitEvent,
  wakeAgentIfPossible,
  dispatchRunToWorker,
  processRunCompletion,
  onRunStarted,
  onRunCompleted,
  notify,
  budgetService,
  sessionService,
  getRuntimeBridge,
}: WorkerServiceDependencies) {
  const MAX_RETRY_ATTEMPTS = 2;
  const RETRY_COOLDOWN_MS = 30_000; // 30 seconds
  const consecutiveWakeMap = new Map<string, number>();
  const MAX_CONSECUTIVE_WAKES = 5;
  const leaseRenewalMap = new Map<string, number>();

  let worker: ReturnType<typeof utilityProcess.fork> | null = null;
  let destroyed = false;
  const pendingRetryTimers = new Set<ReturnType<typeof setTimeout>>();

  /** Crash-loop backoff state. Resets to 0 whenever a worker lives long enough
   * (>HEALTHY_UPTIME_MS) between creation and exit. Past MAX_CRASH_LOOP
   * consecutive fast-crashes we stop respawning and notify the user. */
  const MAX_CRASH_LOOP = 5;
  const BASE_BACKOFF_MS = 1_000;
  const MAX_BACKOFF_MS = 30_000;
  const HEALTHY_UPTIME_MS = 60_000;
  const crashLoopState = { consecutive: 0, halted: false, lastCreatedAt: 0 };

  function scheduleWorkerRespawn() {
    if (crashLoopState.halted || destroyed || isQuitting()) return;
    const uptimeMs = Date.now() - crashLoopState.lastCreatedAt;
    if (uptimeMs >= HEALTHY_UPTIME_MS) {
      crashLoopState.consecutive = 0;
    } else {
      crashLoopState.consecutive += 1;
    }
    if (crashLoopState.consecutive > MAX_CRASH_LOOP) {
      crashLoopState.halted = true;
      logger.error(
        `[worker-service] Worker crashed ${crashLoopState.consecutive} times within ${HEALTHY_UPTIME_MS}ms; halting respawn.`,
      );
      notify({
        title: "Orchestrator Unavailable",
        body: "The background worker keeps crashing. Restart AgentCompany after checking logs.",
        urgency: "critical",
        navigation: { section: "overview" },
      });
      return;
    }
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** (crashLoopState.consecutive - 1), MAX_BACKOFF_MS);
    logger.info(`[worker-service] Respawning worker in ${delay}ms (attempt ${crashLoopState.consecutive}/${MAX_CRASH_LOOP})`);
    setTimeout(() => {
      if (destroyed || isQuitting() || crashLoopState.halted) return;
      createWorker();
    }, delay);
  }

  function getWorker() {
    if (destroyed) return null;
    return worker;
  }

  function createWorker() {
    crashLoopState.lastCreatedAt = Date.now();
    // S-01: Propagate packaged-build signal so the worker can hard-refuse
    // connector bypass flags in production.
    worker = utilityProcess.fork(workerPath, [], {
      stdio: "pipe",
      serviceName: "AgentCompany Orchestrator",
      env: {
        ...process.env,
        AGENTCOMPANY_PACKAGED: app.isPackaged ? "true" : "false",
      },
    });

    worker.stdout?.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) logger.debug(`[worker:stdout] ${text}`);
    });
    worker.stderr?.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) logger.warn(`[worker:stderr] ${text}`);
    });

    worker.on("exit", (code) => {
      if (isQuitting() || destroyed) return;
      handleWorkerExit(
        code,
        { db, logger, isQuitting, publishDomainChanged, emitEvent, wakeAgentIfPossible, dispatchRunToWorker },
        scheduleWorkerRespawn,
        getWorker,
      );
    });

    worker.on("message", async (message) => {
      await handleWorkerMessage(
        message,
        worker,
        { db, logger, isQuitting, emitEvent, wakeAgentIfPossible, processRunCompletion, onRunStarted, onRunCompleted, notify, budgetService, sessionService, getRuntimeBridge },
        workerMessageSchema,
        destroyed,
        MAX_RETRY_ATTEMPTS,
        RETRY_COOLDOWN_MS,
        consecutiveWakeMap,
        MAX_CONSECUTIVE_WAKES,
        pendingRetryTimers,
        leaseRenewalMap,
      );
    });
  }

  function destroy() {
    destroyed = true;

    // Clear all pending retry timers so they never fire after quit
    for (const timer of pendingRetryTimers) {
      clearTimeout(timer);
    }
    pendingRetryTimers.clear();

    if (worker) {
      // Tell the worker to kill all its child CLI processes and exit.
      // Previous approach sent individual cancel-run messages then immediately
      // killed the worker — a race condition that left CLI processes as orphans
      // because the worker died before it could forward SIGTERM to its children.
      try {
        worker.postMessage({ type: "shutdown" });
      } catch (error) {
        logger.debug(
          `[worker-service] shutdown postMessage failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      // Safety net: force-kill worker after 2s if shutdown didn't complete.
      // Track the timer so we can cancel it the moment the worker cleanly
      // exits — otherwise the pending timer keeps the event loop alive.
      const ref = worker;
      const killTimer = setTimeout(() => {
        try {
          ref.kill();
        } catch (error) {
          logger.debug(
            `[worker-service] worker kill() failed (likely already dead): ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }, 2000);
      ref.once("exit", () => clearTimeout(killTimer));
      worker = null;
    }

    // Mark all running/queued runs as interrupted so DB state is clean on restart
    try {
      const snapshot = db.listSnapshot();
      for (const run of snapshot.runs) {
        if (run.status === "running" || run.status === "queued") {
          db.finishRun({
            runId: run.id,
            status: "interrupted",
            summary: "Application shut down.",
            errorMessage: null,
            exitCode: null,
            signal: null,
            model: null,
            sessionDisplayId: null,
            unattributedCost: true,
          });
          if (run.workspaceId) {
            db.releaseWorkspaceLock(run.workspaceId, run.id);
          }
          db.releaseTaskLock(run.taskId, run.id);
        }
      }
    } catch (error) {
      logger.warn(
        `[worker-service] interrupted-run cleanup during shutdown failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    createWorker,
    getWorker,
    destroy,
  };
}
