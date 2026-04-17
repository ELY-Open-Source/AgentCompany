import type { RuntimeBridge } from "../agent-runtime";
import type { workerMessageSchema } from "./worker-types";
import { handleRunLog } from "./handlers/run-log-handler";
import { handleRunStatus } from "./handlers/run-status-handler";
import { handleRunFinished } from "./handlers/run-finished-handler";
import type { HandlerContext, HandlerDeps } from "./handlers/handler-context";

export async function handleWorkerMessage(
  message: unknown,
  worker: ReturnType<typeof import("electron").utilityProcess.fork> | null,
  deps: HandlerDeps & { getRuntimeBridge?: () => RuntimeBridge | null },
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
    case "agent-event": {
      const bridge = deps.getRuntimeBridge?.();
      if (bridge) {
        bridge.handleAgentEvent({
          runId: event.runId,
          agentId: event.agentId,
          companyId: event.companyId,
          taskId: event.taskId,
          emittedAt: event.emittedAt,
          event: event.event,
        });
      }
      return;
    }
    case "rpc-request": {
      const bridge = deps.getRuntimeBridge?.();
      const response = bridge
        ? await bridge.handleRpc({
            rpcId: event.rpcId,
            runId: event.runId,
            method: event.method,
            payload: event.payload,
          })
        : { ok: false as const, error: "RuntimeBridge not initialised." };
      try {
        worker?.postMessage({ type: "rpc-response", rpcId: event.rpcId, response });
      } catch (error) {
        deps.logger.error(
          `[worker] rpc-response postMessage failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return;
    }
  }
}
