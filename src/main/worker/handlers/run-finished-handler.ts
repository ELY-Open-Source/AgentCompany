import {
  accumulateAndRotateSession,
  emitAndNotifyCompletion,
  finalizeRun,
  runPostCompletionAutomation,
  triggerSelfWake,
} from "./run-finished-helpers";
import type { HandlerContext, HandlerDeps, WorkerMessageEvent } from "./handler-context";
import type { RunFinishedContext } from "./run-finished-helpers";

export function handleRunFinished(
  event: Extract<WorkerMessageEvent, { type: "run-finished" }>,
  deps: HandlerDeps,
  context: HandlerContext,
): RunFinishedContext | null {
  const rfCtx = finalizeRun(event, deps, context);
  if (!rfCtx) return null;

  accumulateAndRotateSession(event, deps, rfCtx);
  emitAndNotifyCompletion(event, deps, rfCtx);
  const { hadDeferredWakes } = runPostCompletionAutomation(event, deps, context, rfCtx);
  triggerSelfWake(event, deps, context, rfCtx, hadDeferredWakes);
  return rfCtx;
}
