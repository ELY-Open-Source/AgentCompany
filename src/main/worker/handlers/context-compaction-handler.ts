import { persistRunEvent } from "../observability/run-event-recorder";
import type { HandlerContext, HandlerDeps, WorkerMessageEvent } from "./handler-context";

export function handleContextCompaction(
  event: Extract<WorkerMessageEvent, { type: "context-compaction" }>,
  deps: HandlerDeps,
  _context: HandlerContext,
): void {
  const runState = deps.db.runs.getRunAuthState(event.runId);
  if (!runState) {
    deps.logger.warn(`[context-compaction] run ${event.runId} disappeared before telemetry could be recorded.`);
    return;
  }
  persistRunEvent(deps.db, deps.logger, {
    companyId: runState.companyId,
    runId: event.runId,
    agentId: runState.agentId,
    eventType: "context_compaction",
    level: "info",
    message: `Compacted ${event.compactedOlderMessageCount} older messages into a summary.`,
    payload: {
      emittedAt: event.emittedAt,
      estimatedTokens: event.estimatedTokens,
      originalMessageCount: event.originalMessageCount,
      compactedMessageCount: event.compactedMessageCount,
      compactedOlderMessageCount: event.compactedOlderMessageCount,
      retainedRecentMessageCount: event.retainedRecentMessageCount,
    },
  });
}
