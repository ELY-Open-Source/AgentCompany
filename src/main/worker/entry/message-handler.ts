import type { RuntimeBridge, RuntimeMessageInjector } from "../../agent-runtime";
import type { workerMessageSchema } from "./types";
import { handleRunLog } from "../handlers/run-log-handler";
import { handleRunStatus } from "../handlers/run-status-handler";
import { handleRunFinished } from "../handlers/run-finished-handler";
import { releaseCompletedRunWorkspaceLock } from "../handlers/run-finished-helpers";
import { handleContextCompaction } from "../handlers/context-compaction-handler";
import type { HandlerContext, HandlerDeps } from "../handlers/handler-context";
import type { RunFinishedContext } from "../handlers/run-finished-helpers";
import type { RunResourceReleaseResult } from "../../agent-runtime/runtime-artifact-reconciler";

export async function handleWorkerMessage(
  message: unknown,
  worker: ReturnType<typeof import("electron").utilityProcess.fork> | null,
  deps: HandlerDeps & {
    getRuntimeBridge?: () => RuntimeBridge | null;
    getRuntimeMessageInjector?: () => RuntimeMessageInjector | null;
  },
  workerMessageSchemaRef: typeof workerMessageSchema,
  destroyed: boolean,
  MAX_RETRY_ATTEMPTS: number,
  RETRY_COOLDOWN_MS: number,
  selfWakeAttemptMap: Map<string, number>,
  MAX_CONSECUTIVE_SELF_WAKES: number,
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
    MAX_CONSECUTIVE_SELF_WAKES,
    selfWakeAttemptMap,
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
    case "run-finished": {
      let completion: RunFinishedContext | null = null;
      let runtimeResourcesReleased = false;
      let runtimeReleaseResult: RunResourceReleaseResult = { ok: true };
      const releaseRuntimeResources = (): RunResourceReleaseResult => {
        if (runtimeResourcesReleased) return runtimeReleaseResult;
        runtimeResourcesReleased = true;
        runtimeReleaseResult =
          deps.getRuntimeBridge?.()?.releaseRunResources(event.runId) ?? { ok: true };
        return runtimeReleaseResult;
      };
      try {
        completion = handleRunFinished(event, deps, context, {
          beforePostCompletionAutomation: releaseRuntimeResources,
        });
      } finally {
        releaseRuntimeResources();
      }
      releaseCompletedRunWorkspaceLock(completion, deps);
      if (!worker) {
        throw new Error(`run-completion-ack worker missing for run ${event.runId}`);
      }
      worker.postMessage({ type: "run-completion-ack", runId: event.runId });
      return;
    }
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
    case "context-compaction":
      handleContextCompaction(event, deps, context);
      return;
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
    case "run-agent-state": {
      deps.getRuntimeBridge?.()?.setRunAgentState(event.runId, event.state);
      return;
    }
    case "steer-ack": {
      deps.getRuntimeMessageInjector?.()?.handleSteerAck(event.correlationId, event.accepted);
      return;
    }
  }
}
