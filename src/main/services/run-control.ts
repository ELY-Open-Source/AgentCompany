import { AsyncLocalStorage } from "node:async_hooks";

/** The error message a run ends with when the operator stops it. */
export const RUN_STOPPED_MESSAGE = "Stopped by the operator.";

const runSignals = new AsyncLocalStorage<AbortSignal>();
const controllers = new Map<string, AbortController>();

/** Runs a session under a stop signal that every provider request and tool inside it observes. */
export async function withRunControl<T>(runId: string, operation: () => Promise<T>): Promise<T> {
  const controller = new AbortController();
  controllers.set(runId, controller);
  try {
    return await runSignals.run(controller.signal, operation);
  } finally {
    controllers.delete(runId);
  }
}

/** Stops one in-flight run with a reason; false when it is not running in this process. */
export function stopRun(runId: string, reason: string = RUN_STOPPED_MESSAGE): boolean {
  const controller = controllers.get(runId);
  if (!controller) return false;
  console.info(`[run-control] stopping run ${runId}: ${reason}`);
  controller.abort(new Error(reason));
  return true;
}

export function stopAllRuns(): number {
  const ids = [...controllers.keys()];
  for (const id of ids) stopRun(id);
  return ids.length;
}

/** The stop signal of the run this code executes in, if any. */
export function currentRunSignal(): AbortSignal | undefined {
  return runSignals.getStore();
}

/** Why the current run was stopped, or null while it may continue. */
export function runStopReason(): string | null {
  const signal = currentRunSignal();
  if (!signal?.aborted) return null;
  return signal.reason instanceof Error ? signal.reason.message : RUN_STOPPED_MESSAGE;
}

export function throwIfRunStopped(): void {
  const reason = runStopReason();
  if (reason) throw new Error(reason);
}

/** Settles with the operation, or rejects as soon as the run is stopped; work without its own abort is abandoned. */
export function untilStopped<T>(operation: Promise<T>): Promise<T> {
  const signal = currentRunSignal();
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(new Error(runStopReason() ?? RUN_STOPPED_MESSAGE));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error(runStopReason() ?? RUN_STOPPED_MESSAGE));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
