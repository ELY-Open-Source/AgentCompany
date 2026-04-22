import { app } from "electron";
import type { AgentApiServer } from "../api-server";
import type { AppDatabase } from "../database";
import { BrowserManager } from "../browser-manager";
import { createAppLifecycleService } from "../app-lifecycle-service";
import type { createAutomationService } from "../automation-service";
import type { createDesktopShellService } from "../desktop-shell-service";
import type { createOrchestrationService } from "../orchestration-service";
import type { createWorkerService } from "../worker-service";
import type { PiRuntimeServices } from "../service-graph-pi-runtime";

/** Overall budget for awaited shutdown drain (worker exit + API close). */
const SHUTDOWN_BUDGET_MS = 5_000;

export interface LifecycleDeps {
  db: AppDatabase;
  logger: {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  isQuittingRef: { current: boolean };
  apiServerRef: { current: AgentApiServer | null };
  browserManagerRef: { current: BrowserManager | null };
  piRuntimeRef: { current: PiRuntimeServices | null };
  orchestrationService: ReturnType<typeof createOrchestrationService>;
  automationService: ReturnType<typeof createAutomationService>;
  workerService: ReturnType<typeof createWorkerService>;
  desktopShellService: ReturnType<typeof createDesktopShellService>;
  /**
   * Clears graph-owned service refs (so getters return null) after the drain
   * completes. Mirrors the original synchronous null-out at the tail of the
   * old onBeforeQuit.
   */
  clearServiceRefs: () => void;
}

/**
 * Build the app lifecycle service and wire a deterministic shutdown drain
 * that awaits the utility-process worker's exit (and API server close)
 * before calling app.exit(). On 5s timeout we log the stuck run ids and
 * exit(1) so operators see an unclean shutdown rather than a silent
 * force-kill.
 */
export function createLifecycle(deps: LifecycleDeps) {
  const {
    db,
    logger,
    isQuittingRef,
    apiServerRef,
    browserManagerRef,
    piRuntimeRef,
    orchestrationService,
    automationService,
    workerService,
    desktopShellService,
    clearServiceRefs,
  } = deps;

  let drainPromise: Promise<number> | null = null;

  function listActiveRunIds(): string[] {
    try {
      return db.projection.snapshot.listSnapshot().runs
        .filter((r) => r.status === "running" || r.status === "queued")
        .map((r) => r.id);
    } catch (err) {
      logger.warn("[lifecycle] listActiveRunIds failed:", err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  async function drain(): Promise<number> {
    // Stop accepting new scheduled work first; cancel in-flight runs in the
    // worker via the utility-process shutdown postMessage inside destroy().
    try { orchestrationService.stopAllSchedulers(); } catch (err) { logger.warn("[lifecycle] stopAllSchedulers failed:", err); }
    try { automationService.destroy(); } catch (err) { logger.warn("[lifecycle] automationService.destroy failed:", err); }
    try { apiServerRef.current?.stop(); } catch (err) { logger.warn("[lifecycle] apiServer.stop failed:", err); }
    apiServerRef.current = null;
    try { browserManagerRef.current?.shutdown(); } catch (err) { logger.warn("[lifecycle] browserManager.shutdown failed:", err); }
    browserManagerRef.current = null;

    // workerService.destroy() sends "shutdown" to the utility process and has
    // its own 2s SIGKILL safety net. Awaiting the worker's exit event closes
    // the remaining event-loop holder (the utilityProcess handle).
    const workerExit = new Promise<void>((resolve) => {
      const worker = workerService.getWorker();
      if (!worker) { resolve(); return; }
      worker.once("exit", () => resolve());
    });
    workerService.destroy();

    const timeout = new Promise<"timeout">((resolve) => {
      const handle = setTimeout(() => resolve("timeout"), SHUTDOWN_BUDGET_MS);
      if (typeof handle.unref === "function") handle.unref();
    });
    const outcome = await Promise.race([
      workerExit.then(() => "drained" as const),
      timeout,
    ]);

    try { desktopShellService.destroy(); } catch (err) { logger.warn("[lifecycle] desktopShell.destroy failed:", err); }
    try { piRuntimeRef.current?.release(); } catch (err) { logger.warn("[lifecycle] piRuntime.release failed:", err); }
    piRuntimeRef.current = null;
    try { db.close(); } catch (err) { logger.warn("[lifecycle] db.close failed:", err); }

    clearServiceRefs();

    if (outcome === "timeout") {
      const stuck = listActiveRunIds();
      logger.error(
        `[lifecycle] Drain exceeded ${SHUTDOWN_BUDGET_MS}ms; stuck runs: ${stuck.length ? stuck.join(", ") : "<none>"}`,
      );
      return 1;
    }
    return 0;
  }

  const appLifecycleService = createAppLifecycleService({
    getMainWindow: () => desktopShellService.getMainWindow(),
    ensureWindow: async () => desktopShellService.ensureWindow(),
    shouldQuit: () => isQuittingRef.current,
    onBeforeQuit: () => {
      if (drainPromise) return;
      isQuittingRef.current = true;
      drainPromise = drain().catch((err) => {
        logger.error("[lifecycle] drain threw unexpectedly:", err);
        return 1;
      });
      drainPromise.then((code) => {
        app.exit(code);
      });
    },
  });

  return appLifecycleService;
}
