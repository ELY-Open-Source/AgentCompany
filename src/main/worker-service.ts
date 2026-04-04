import { utilityProcess } from "electron";
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
}: WorkerServiceDependencies) {
  const MAX_RETRY_ATTEMPTS = 2;
  const RETRY_COOLDOWN_MS = 30_000; // 30 seconds
  const consecutiveWakeMap = new Map<string, number>();
  const MAX_CONSECUTIVE_WAKES = 5;
  const leaseRenewalMap = new Map<string, number>();

  let worker: ReturnType<typeof utilityProcess.fork> | null = null;
  let destroyed = false;
  const pendingRetryTimers = new Set<ReturnType<typeof setTimeout>>();

  function getWorker() {
    if (destroyed) return null;
    return worker;
  }

  function createWorker() {
    worker = utilityProcess.fork(workerPath, [], {
      stdio: "pipe",
      serviceName: "AgentCompany Orchestrator",
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
        createWorker,
        getWorker,
      );
    });

    worker.on("message", async (message) => {
      await handleWorkerMessage(
        message,
        worker,
        { db, logger, isQuitting, emitEvent, wakeAgentIfPossible, processRunCompletion, onRunStarted, onRunCompleted, notify, budgetService, sessionService },
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
      } catch { /* worker may already be dead */ }

      // Safety net: force-kill worker after 2s if shutdown didn't complete
      const ref = worker;
      setTimeout(() => {
        try { ref.kill(); } catch { /* already dead */ }
      }, 2000);
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
            costUsd: null,
            unattributedCost: true,
          });
          if (run.workspaceId) {
            db.releaseWorkspaceLock(run.workspaceId, run.id);
          }
          db.releaseTaskLock(run.taskId, run.id);
        }
      }
    } catch { /* best effort during shutdown */ }
  }

  return {
    createWorker,
    getWorker,
    destroy,
  };
}
