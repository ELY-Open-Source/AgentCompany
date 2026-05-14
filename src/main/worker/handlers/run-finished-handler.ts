import {
  accumulateAndRotateSession,
  emitAndNotifyCompletion,
  finalizeRun,
  runPostCompletionAutomation,
  triggerSelfWake,
} from "./run-finished-helpers";
import type { HandlerContext, HandlerDeps, WorkerMessageEvent } from "./handler-context";
import type { RunFinishedContext } from "./run-finished-helpers";

export interface RunFinishedHooks {
  beforePostCompletionAutomation?: (context: RunFinishedContext) =>
    | void
    | { ok: true }
    | { ok: false; errorMessage: string };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function handleRunFinished(
  event: Extract<WorkerMessageEvent, { type: "run-finished" }>,
  deps: HandlerDeps,
  context: HandlerContext,
  hooks: RunFinishedHooks = {},
): RunFinishedContext | null {
  const rfCtx = finalizeRun(event, deps, context);
  if (!rfCtx) return null;

  accumulateAndRotateSession(event, deps, rfCtx);
  const boundaryResult = hooks.beforePostCompletionAutomation?.(rfCtx);
  const effectiveEvent =
    boundaryResult && !boundaryResult.ok
      ? {
          ...event,
          status: "failed" as const,
          summary: null,
          errorMessage: boundaryResult.errorMessage,
          usageStatus: "error_stop" as const,
        }
      : event;
  if (boundaryResult && !boundaryResult.ok) {
    try {
      deps.db.core.runs.markRunCompletionFailure(event.runId, boundaryResult.errorMessage);
    } catch (error) {
      deps.logger.error(`[worker] markRunCompletionFailure failed for artifact boundary ${event.runId}: ${errorMessage(error)}`);
    }
  }
  emitAndNotifyCompletion(effectiveEvent, deps, rfCtx);
  const { hadDeferredWakes } = runPostCompletionAutomation(effectiveEvent, deps, context, rfCtx);
  triggerSelfWake(effectiveEvent, deps, context, rfCtx, hadDeferredWakes);
  return rfCtx;
}
