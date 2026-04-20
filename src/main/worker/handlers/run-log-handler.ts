import { filterRunLogChunk } from "../observability/run-log-filter";
import { persistRunEvent } from "../observability/run-event-recorder";
import type { HandlerContext, HandlerDeps, WorkerMessageEvent } from "./handler-context";
import { classifyUnknownError } from "../../errors/index.js";

const LEASE_RENEWAL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export async function handleRunLog(
  event: Extract<WorkerMessageEvent, { type: "run-log" }>,
  deps: HandlerDeps,
  context: HandlerContext,
): Promise<void> {
  const { db, logger, emitEvent } = deps;
  const { leaseRenewalMap } = context;

  const filtered = filterRunLogChunk(event.stream, event.chunk);
  if (filtered === null) return;

  await db.appendRunLog(event.runId, event.stream, filtered);
  const runState = db.getRunAuthState(event.runId);
  if (runState) {
    persistRunEvent(db, logger, {
      companyId: runState.companyId,
      runId: event.runId,
      agentId: runState.agentId,
      eventType: "run_log",
      stream: event.stream,
      message: filtered,
    });
  }
  emitEvent({ ...event, chunk: filtered });

  // Throttled lease renewal: keep execution lock alive for long-running tasks.
  // Without this, tasks exceeding the 15-minute stale lock timeout get reclaimed.
  const now = Date.now();
  const lastRenewal = leaseRenewalMap.get(event.runId) ?? 0;
  if (now - lastRenewal >= LEASE_RENEWAL_INTERVAL_MS) {
    try {
      const run = db.getRun(event.runId);
      if (run.taskId) {
        db.tasks.renewTaskLease(run.taskId, run.id);
      }
      leaseRenewalMap.set(event.runId, now);
    } catch (err) {
      const classified = classifyUnknownError(err, {
        kind: "recoverable",
        code: "worker.run_log.lease_renewal_lookup_failed",
        message: `Run ${event.runId} not found during lease renewal`,
        context: { runId: event.runId },
      });
      logger.warn(`[${classified.code}] ${classified.message}`);
    }
  }
}
