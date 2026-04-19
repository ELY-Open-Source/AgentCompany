/**
 * Runtime message injector — the inward half of the Slack-like
 * messaging system. When an agent has an active pi run, incoming
 * direct / channel / mention messages must reach the agent *during*
 * the loop, not on the next heartbeat. Pre-Task-3 the only delivery
 * path was a batched `prepareRun` projection, so any message that
 * arrived while the recipient was working sat dark until the next
 * wake.
 *
 * This module closes that gap by routing a projected pi AgentMessage
 * into the worker's active Agent via the `steer-run` ParentMessage.
 * Pi's steering queue drains at the next turn boundary; the agent
 * observes the new user turn and can react in-loop.
 *
 * Delivery is best-effort and marked as delivered upon post. The
 * session-store shadow still writes via the normal pi message_end
 * event so the transcript remains durable. Callers fall back to the
 * existing inbox+wake path when `tryInject` returns false.
 */

import type { AppDatabase } from "@main/database";
import type { AgentMessageRecord } from "@shared/types";
import { projectInboxMessageToPi } from "./inbox-projection";
import type { RuntimeBridge } from "./runtime-bridge";
import type { ParentMessage } from "@main/worker/worker-helpers";

export interface RuntimeMessageInjectorDeps {
  db: AppDatabase;
  runtimeBridge: RuntimeBridge;
  postToWorker: (message: ParentMessage) => void;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };
}

export class RuntimeMessageInjector {
  constructor(private readonly deps: RuntimeMessageInjectorDeps) {}

  /**
   * Attempts to deliver a persisted inbox message into the recipient's
   * live pi run. Returns true when the message was dispatched to the
   * worker, false when no active run exists for the recipient.
   *
   * The caller owns the "post-delivery" decision: on true, it should
   * skip the regular `wakeAgentIfPossible` path for this recipient; on
   * false, it falls back to the legacy inbox+wake flow.
   */
  tryInject(recipientAgentId: string, companyId: string, message: AgentMessageRecord): boolean {
    const ctx = this.deps.runtimeBridge.findActiveRunForAgent(recipientAgentId);
    if (!ctx) return false;
    if (ctx.companyId !== companyId) {
      this.deps.logger.warn(
        `[injector] refusing cross-company steer: agent ${recipientAgentId} active in ${ctx.companyId}, message from ${companyId}`,
      );
      return false;
    }

    const projected = projectInboxMessageToPi(message, {
      getAgentName: (id) => this.resolveAgentName(id),
    });

    try {
      this.deps.postToWorker({ type: "steer-run", runId: ctx.runId, message: projected });
    } catch (error) {
      this.deps.logger.warn(
        `[injector] postToWorker steer-run failed for run ${ctx.runId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }

    try {
      this.deps.db.markAgentInboxDelivered(recipientAgentId, [message.id]);
    } catch (error) {
      this.deps.logger.warn(
        `[injector] markAgentInboxDelivered failed for ${message.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return true;
  }

  private resolveAgentName(agentId: string): string {
    try {
      const name = this.deps.db.findAgentName(agentId);
      if (name && name.length > 0) return name;
    } catch {
      // fall through
    }
    return agentId;
  }
}
