import type { AppDatabase } from "@main/database";
import type { AgentMessageRecord } from "@shared/types";
import {
  ensureAgentCommunicationThread,
  ensureTaskThread,
} from "@main/thread-integration/thread-helpers";
import { extractTextBody } from "./agent-event-projection";
import type { InboundCorrelationEntry } from "./inbound-correlation-registry";

type RuntimeThreadEnvelope = {
  runId: string;
  agentId: string;
  companyId: string;
  taskId: string | null;
};

type RuntimeThreadMessage = {
  role?: string;
  content?: unknown;
  toolCallId?: string;
  timestamp?: number;
};

interface RuntimeThreadProjectorDeps {
  db: AppDatabase;
  logger: {
    warn: (...args: unknown[]) => void;
  };
  resolveAgentName: (agentId: string) => string;
  lookupInboundCorrelation: (
    runId: string,
    timestamp: number | undefined,
  ) => InboundCorrelationEntry | null;
}

export class RuntimeThreadProjector {
  constructor(private readonly deps: RuntimeThreadProjectorDeps) {}

  /**
   * Project the pi `message_end` event into a `conversation_events` row
   * so renderer thread views stay live.
   */
  recordThreadEvent(
    envelope: RuntimeThreadEnvelope,
    message: RuntimeThreadMessage | undefined,
  ): void {
    if (!message?.role) return;

    const thread = this.resolveThreadForRun(envelope);
    if (!thread) return;

    try {
      const body = extractTextBody(message.content);
      const actor = this.resolveThreadEventActor(envelope, message);
      this.deps.db.core.threads.addThreadEvent({
        threadId: thread.id,
        actorId: actor.actorId,
        actorType: actor.actorType,
        eventType: message.role === "toolResult" ? "system_note" : "message",
        body: body.length > 4000 ? `${body.slice(0, 3997)}...` : body,
        metadataJson: JSON.stringify({
          runId: envelope.runId,
          role: message.role,
          sourceMessageId: actor.sourceMessageId ?? undefined,
        }),
      });
    } catch (error) {
      this.deps.logger.warn(
        `[runtime-bridge] failed to project agent-event into thread ${thread.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Persist an inbound peer message projected as a prior turn during
   * `prepareRun`; priorMessages do not emit `message_end`.
   */
  recordInboundMessageAsThreadEvent(
    envelope: RuntimeThreadEnvelope,
    record: AgentMessageRecord,
  ): void {
    const thread = this.resolveThreadForRun(envelope);
    if (!thread) return;
    try {
      const body = record.body.length > 4000 ? `${record.body.slice(0, 3997)}...` : record.body;
      const actorType: "agent" | "user" | "system" =
        record.senderKind === "human"
          ? "user"
          : record.senderKind === "system"
            ? "system"
            : "agent";
      this.deps.db.core.threads.addThreadEvent({
        threadId: thread.id,
        actorId: record.fromAgentId,
        actorType,
        eventType: "message",
        body,
        metadataJson: JSON.stringify({
          runId: envelope.runId,
          role: "user",
          sourceMessageId: record.id,
          projection: "prepare_run",
        }),
      });
    } catch (error) {
      this.deps.logger.warn(
        `[runtime-bridge] inbound thread-event write failed for message ${record.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private resolveThreadForRun(envelope: RuntimeThreadEnvelope) {
    if (envelope.taskId) {
      try {
        const task = this.deps.db.core.entity.getTask(envelope.taskId);
        return ensureTaskThread(this.deps.db, envelope.taskId, envelope.companyId, task.title);
      } catch (error) {
        this.deps.logger.warn(
          `[runtime-bridge] getTask failed for ${envelope.taskId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
      }
    }
    try {
      const agentLabel = this.deps.resolveAgentName(envelope.agentId);
      return ensureAgentCommunicationThread(
        this.deps.db,
        envelope.agentId,
        envelope.companyId,
        agentLabel,
      );
    } catch (error) {
      this.deps.logger.warn(
        `[runtime-bridge] ensureAgentCommunicationThread failed for ${envelope.agentId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private resolveThreadEventActor(
    envelope: { runId: string; agentId: string },
    message: { role?: string; timestamp?: number },
  ): { actorId: string; actorType: "agent" | "user" | "system"; sourceMessageId: string | null } {
    if (message.role === "user") {
      const correlation = this.deps.lookupInboundCorrelation(envelope.runId, message.timestamp);
      if (correlation) {
        const actorType: "agent" | "user" | "system" =
          correlation.senderKind === "human"
            ? "user"
            : correlation.senderKind === "system"
              ? "system"
              : "agent";
        return {
          actorId: correlation.fromAgentId,
          actorType,
          sourceMessageId: correlation.messageId,
        };
      }
      return { actorId: "user", actorType: "user", sourceMessageId: null };
    }
    if (message.role === "assistant") {
      return { actorId: envelope.agentId, actorType: "agent", sourceMessageId: null };
    }
    return { actorId: envelope.agentId, actorType: "system", sourceMessageId: null };
  }
}
