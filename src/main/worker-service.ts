import { app, utilityProcess } from "electron";
import { workerMessageSchema, type WorkerServiceDependencies } from "./worker/entry/types";
import { handleWorkerExit } from "./worker/entry/crash-recovery";
import { handleWorkerMessage } from "./worker/entry/message-handler";
import { DEFAULT_MAX_CONSECUTIVE_SELF_WAKES } from "./run-attempt-policy";

export { workerMessageSchema } from "./worker/entry/types";

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
  getRuntimeMessageInjector,
}: WorkerServiceDependencies) {
  const MAX_RETRY_ATTEMPTS = 2;
  const RETRY_COOLDOWN_MS = 30_000; // 30 seconds
  const selfWakeAttemptMap = new Map<string, number>();
  const MAX_CONSECUTIVE_SELF_WAKES = DEFAULT_MAX_CONSECUTIVE_SELF_WAKES;
  const leaseRenewalMap = new Map<string, number>();

  let worker: ReturnType<typeof utilityProcess.fork> | null = null;
  let destroyed = false;
  let shutdownPromise: Promise<void> | null = null;
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
      if (isShutdownReadyMessage(message)) {
        try {
          worker?.postMessage({ type: "shutdown-exit" });
        } catch (error) {
          logger.debug(
            `[worker-service] shutdown-exit postMessage failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        return;
      }
      await handleWorkerMessage(
        message,
        worker,
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
          getRuntimeBridge,
          getRuntimeMessageInjector,
        },
        workerMessageSchema,
        destroyed,
        MAX_RETRY_ATTEMPTS,
        RETRY_COOLDOWN_MS,
        selfWakeAttemptMap,
        MAX_CONSECUTIVE_SELF_WAKES,
        pendingRetryTimers,
        leaseRenewalMap,
      );
    });
  }

  function collectShutdownRuns(): Array<{
    id: string;
    taskId: string | null;
    workspaceId: string | null;
  }> {
    try {
      const snapshot = db.projection.snapshot.listSnapshot();
      return snapshot.runs
        .filter((run) => run.status === "running" || run.status === "queued")
        .map((run) => ({ id: run.id, taskId: run.taskId, workspaceId: run.workspaceId }));
    } catch (error) {
      logger.warn(
        `[worker-service] shutdown run collection failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  function interruptShutdownRuns(runs: Array<{
    id: string;
    taskId: string | null;
    workspaceId: string | null;
  }>): void {
    try {
      for (const run of runs) {
        let status: string;
        try {
          status = db.core.runs.getRun(run.id).status;
        } catch (error) {
          logger.warn(
            `[worker-service] shutdown cleanup skipped missing run ${run.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
          continue;
        }
        if (status !== "running" && status !== "queued") {
          continue;
        }
        db.core.runs.finishRun({
          runId: run.id,
          status: "interrupted",
          summary: "Application shut down.",
          errorMessage: null,
          exitCode: null,
          signal: null,
          model: null,
          unattributedCost: true,
        });
        if (run.workspaceId) {
          db.core.workspaces.releaseWorkspaceLock(run.workspaceId, run.id);
        }
        if (run.taskId) {
          db.core.tasks.releaseTaskLock(run.taskId, run.id);
        }
      }
    } catch (error) {
      logger.warn(
        `[worker-service] interrupted-run cleanup during shutdown failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  function shutdown(): Promise<void> {
    if (shutdownPromise) return shutdownPromise;
    destroyed = true;
    const shutdownRuns = collectShutdownRuns();

    for (const timer of pendingRetryTimers) {
      clearTimeout(timer);
    }
    pendingRetryTimers.clear();

    if (!worker) {
      interruptShutdownRuns(shutdownRuns);
      shutdownPromise = Promise.resolve();
      return shutdownPromise;
    }

    const ref = worker;
    shutdownPromise = new Promise<void>((resolve) => {
      ref.once("exit", () => {
        if (worker === ref) worker = null;
        interruptShutdownRuns(shutdownRuns);
        resolve();
      });
      try {
        ref.postMessage({ type: "shutdown" });
      } catch (error) {
        logger.debug(
          `[worker-service] shutdown postMessage failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
    return shutdownPromise;
  }

  function destroy() {
    void shutdown();
  }

  return {
    createWorker,
    getWorker,
    shutdown,
    destroy,
  };
}

function isShutdownReadyMessage(message: unknown): message is { type: "shutdown-ready" } {
  return Boolean(message && typeof message === "object" && (message as { type?: unknown }).type === "shutdown-ready");
}
