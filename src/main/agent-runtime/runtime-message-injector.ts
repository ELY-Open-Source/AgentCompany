/**
 * Runtime message injector — the inward half of the Slack-like messaging
 * system. When an agent has an active pi run, incoming direct, channel,
 * or mention messages must reach the agent during the loop rather than
 * on the next heartbeat. Pre-injector, the only delivery path was the
 * batched `prepareRun` projection, so any message that arrived while the
 * recipient was running sat dark until the next wake.
 *
 * Delivery is a two-step handshake:
 *
 *   main → worker    steer-run { correlationId, runId, message }
 *   worker → main    steer-ack { correlationId, accepted }
 *
 * The worker's `runner.steer()` is the single authority for whether the
 * message reached the live Agent. Main holds the inbox `delivered_at`
 * write until the ACK lands: a positive ACK commits the write; a rejected
 * or timed-out ACK leaves the row unread and re-triggers the recipient's
 * wake, so the next `prepareRun` picks the message up via the regular
 * inbox projection. Either way the message is observed exactly once.
 *
 * The injector short-circuits when the active run is not in
 * `agent_active` — `preparing` and `closing` windows cannot accept a
 * steer — and the caller falls back to the wake + inbox flow directly.
 */

import { randomUUID } from "node:crypto";
import type { AppDatabase } from "@main/database";
import type { AgentMessageRecord } from "@shared/types";
import type { ParentMessage } from "@main/worker/runtime/helpers";
import type { RuntimeBridge } from "./runtime-bridge";

export interface RuntimeMessageInjectorDeps {
  db: AppDatabase;
  runtimeBridge: RuntimeBridge;
  postToWorker: (message: ParentMessage) => void;
  /**
   * Lazy wake hook. The injector is instantiated before orchestration so
   * the wake function has to be resolved per-call; returning `null` means
   * orchestration is not yet online, in which case the caller will have
   * handled the wake path already.
   */
  getWakeAgent: () => ((agentId: string, companyId: string, trigger: string) => string | null) | null;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };
  steerAckTimeoutMs?: number;
}

interface PendingSteer {
  recipientAgentId: string;
  companyId: string;
  runId: string;
  message: AgentMessageRecord;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_STEER_ACK_TIMEOUT_MS = 5_000;

export class RuntimeMessageInjector {
  private readonly pending = new Map<string, PendingSteer>();
  private readonly ackTimeoutMs: number;

  constructor(private readonly deps: RuntimeMessageInjectorDeps) {
    this.ackTimeoutMs = deps.steerAckTimeoutMs ?? DEFAULT_STEER_ACK_TIMEOUT_MS;
  }

  /**
   * Attempts to deliver a persisted inbox message into the recipient's
   * live pi run. Returns true when the steer was dispatched to the worker
   * with a pending ACK — callers must skip the synchronous wake fallback
   * for this recipient because the injector now owns the message's fate:
   * it will either mark the row delivered on a positive ACK or trigger a
   * wake on a negative/timed-out ACK.
   *
   * Returns false when no steer was dispatched (no active run, cross-
   * company mismatch, or the run is not yet `agent_active`). Callers then
   * fall through to the legacy inbox + wake flow immediately.
   */
  tryInject(recipientAgentId: string, companyId: string, message: AgentMessageRecord): boolean {
    const ctx = this.deps.runtimeBridge.findActiveRunForAgent(recipientAgentId, {
      requireSteerReady: true,
    });
    if (!ctx) return false;
    if (ctx.companyId !== companyId) {
      this.deps.logger.warn(
        `[injector] refusing cross-company steer: agent ${recipientAgentId} active in ${ctx.companyId}, message from ${companyId}`,
      );
      return false;
    }

    // Delegate projection + correlation registration to the bridge so
    // the worker steers the exact same pi-message object that the
    // bridge has indexed under `record.id`. `projectInboundMessage`
    // allocates a monotonic `piTimestamp` which is what `message_end`
    // surfaces back on the wire — two inbound rows that share the
    // same wall-clock millisecond are no longer indistinguishable.
    const projected = this.deps.runtimeBridge.projectInboundMessage(ctx.runId, message);
    const correlationId = randomUUID();

    try {
      this.deps.postToWorker({
        type: "steer-run",
        runId: ctx.runId,
        correlationId,
        message: projected,
      });
    } catch (error) {
      this.deps.logger.warn(
        `[injector] postToWorker steer-run failed for run ${ctx.runId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }

    const timer = setTimeout(() => {
      this.resolvePending(correlationId, false, "timeout");
    }, this.ackTimeoutMs);
    if (typeof timer.unref === "function") timer.unref();

    this.pending.set(correlationId, {
      recipientAgentId,
      companyId,
      runId: ctx.runId,
      message,
      timer,
    });
    return true;
  }

  /**
   * Routed from `worker-message-handler` on every `steer-ack`. Confirms
   * the message reached the live Agent (the bridge already registered
   * the inbound correlation when it built the projection). On rejection
   * the recipient is woken so the next `prepareRun` picks the message
   * up through the regular inbox projection.
   *
   * The read receipt is intentionally NOT written here: "the worker
   * queued this message onto the agent" is not "the agent replied".
   * The agent inserts into `agent_message_reads` itself by POSTing
   * /messages/{id}/read once it has actually processed the row.
   */
  handleSteerAck(correlationId: string, accepted: boolean): void {
    this.resolvePending(correlationId, accepted, "worker_ack");
  }

  private resolvePending(
    correlationId: string,
    accepted: boolean,
    source: "worker_ack" | "timeout",
  ): void {
    const entry = this.pending.get(correlationId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(correlationId);

    if (accepted) return;

    this.deps.logger.warn(
      `[injector] steer rejected (${source}) for message ${entry.message.id} to agent ${entry.recipientAgentId}; falling back to wake + inbox projection`,
    );

    const wake = this.deps.getWakeAgent();
    if (!wake) return;
    try {
      wake(entry.recipientAgentId, entry.companyId, "message");
    } catch (error) {
      this.deps.logger.warn(
        `[injector] wake fallback failed for agent ${entry.recipientAgentId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

}
