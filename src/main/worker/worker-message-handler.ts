import type { workerMessageSchema } from "./worker-types";
import { handleRunLog } from "./handlers/run-log-handler";
import { handleRunStatus } from "./handlers/run-status-handler";
import { handleRunFinished } from "./handlers/run-finished-handler";
import type { HandlerContext, HandlerDeps } from "./handlers/handler-context";

export async function handleWorkerMessage(
  message: unknown,
  _worker: ReturnType<typeof import("electron").utilityProcess.fork> | null,
  deps: HandlerDeps,
  workerMessageSchemaRef: typeof workerMessageSchema,
  destroyed: boolean,
  MAX_RETRY_ATTEMPTS: number,
  RETRY_COOLDOWN_MS: number,
  consecutiveWakeMap: Map<string, number>,
  MAX_CONSECUTIVE_WAKES: number,
  pendingRetryTimers: Set<ReturnType<typeof setTimeout>>,
  leaseRenewalMap: Map<string, number>,
) {
  const parsed = workerMessageSchemaRef.safeParse(message);
  if (!parsed.success) {
    deps.logger.error("[worker] invalid message payload", parsed.error);
    return;
  }
  const event = parsed.data;

  const context: HandlerContext = {
    destroyed,
    MAX_RETRY_ATTEMPTS,
    RETRY_COOLDOWN_MS,
    MAX_CONSECUTIVE_WAKES,
    consecutiveWakeMap,
    pendingRetryTimers,
    leaseRenewalMap,
  };

  switch (event.type) {
    case "run-log":
      await handleRunLog(event, deps, context);
      return;
    case "run-status":
      handleRunStatus(event, deps, context);
      return;
    case "run-finished":
      handleRunFinished(event, deps, context);
      return;
  }
}
