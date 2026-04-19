import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AppDatabase } from "@main/database";
import type { AgentMessageRecord, DesktopEvent } from "@shared/types";
import {
  ensureAgentCommunicationThread,
  ensureTaskThread,
} from "@main/thread-integration/thread-helpers";
import { SqliteSessionStore } from "./sqlite-session-store";
import { CostWriter } from "./cost-writer";
import type { CredentialResolver } from "@main/credentials";
import { getConnectorDefinition } from "@main/connectors";
import { projectInboxMessageToPi } from "./inbox-projection";
import { projectAgentEventToLogChunk, extractTextBody } from "./agent-event-projection";
import { reconcileWorkspaceArtifacts } from "./artifact-projector";
import {
  handleBeforeToolCall,
  handleAfterToolCall,
  handleTransformContext,
  type ActiveRunContext,
  type ActiveRunLifecycleState,
} from "./hook-handlers";
import type {
  AfterToolCallRpcPayload,
  BeforeToolCallRpcPayload,
  TransformContextRpcPayload,
} from "./hook-rpc";

export interface RuntimeBridgeDeps {
  db: AppDatabase;
  emitEvent: (event: DesktopEvent) => void;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  credentialResolver: CredentialResolver;
}

type RpcMethod =
  | "persistMessage"
  | "prepareRun"
  | "beforeToolCall"
  | "afterToolCall"
  | "transformContext";

/**
 * Single owner of pi runtime side-effects in main.
 *
 * - Forwards `agent-event` from the worker to the renderer (push channel).
 * - Persists each `message_end` message via `SqliteSessionStore`.
 * - Calls `CostWriter` for assistant messages with usage.
 * - Proxies pi's tool-execution hooks (`beforeToolCall` / `afterToolCall`
 *   / `transformContext`) into policy handlers: approval-gate checks,
 *   filesystem artifact projection, and context compaction.
 *
 * Policy itself lives in `hook-handlers.ts`; this class is a pure IPC
 * router plus an `ActiveRunContext` cache.
 */
interface InboundCorrelationEntry {
  fromAgentId: string;
  senderKind: AgentMessageRecord["senderKind"];
  messageId: string;
}

export class RuntimeBridge {
  private readonly costWriter: CostWriter;
  private readonly activeRuns = new Map<string, ActiveRunContext>();
  private readonly sessionStores = new Map<string, SqliteSessionStore>();
  /**
   * Per-run mapping from pi-message timestamp to the inbound message that
   * sourced it. The transcript only carries a rendered `[Message from X]`
   * header, which is insufficient to recover the original author when the
   * thread-event writer fires on `message_end`. Writers (inbox projection
   * during prepareRun, steer injection during the run) register the entry
   * before pi surfaces the message so the author-id survives the
   * round-trip.
   */
  private readonly inboundCorrelations = new Map<string, Map<number, InboundCorrelationEntry>>();

  constructor(private readonly deps: RuntimeBridgeDeps) {
    this.costWriter = new CostWriter({ db: deps.db });
  }

  private registerActiveRun(context: ActiveRunContext): void {
    this.activeRuns.set(context.runId, context);
    this.getOrCreateStore(context.taskSessionId);
  }

  /**
   * Evicts the per-run `activeRuns` context, the per-session store cache,
   * and the inbound-correlation log. Callers must invoke after a
   * `run-finished` worker message so the maps stay bounded by concurrent-
   * run count rather than process lifetime.
   *
   * Before eviction, sweeps the workspace to register any filesystem
   * artifacts the per-tool `afterToolCall` hook missed. This is the
   * backstop that keeps the DocumentCenter consistent with the disk even
   * when individual projections skipped (bash against a non-git repo,
   * path-ignore false positives, transient `git status` failures).
   */
  releaseRunResources(runId: string): void {
    const ctx = this.activeRuns.get(runId);
    if (ctx) this.reconcileArtifactsForRun(ctx);
    this.activeRuns.delete(runId);
    this.inboundCorrelations.delete(runId);
    if (ctx) this.sessionStores.delete(ctx.taskSessionId);
  }

  private reconcileArtifactsForRun(ctx: ActiveRunContext): void {
    if (!ctx.workspacePath) return;
    try {
      const outcomes = reconcileWorkspaceArtifacts(this.deps.db, {
        runId: ctx.runId,
        agentId: ctx.agentId,
        companyId: ctx.companyId,
        taskId: ctx.taskId,
        workspacePath: ctx.workspacePath,
      });
      const inserted = outcomes.filter((o) => o.kind === "inserted").length;
      if (inserted > 0) {
        this.deps.logger.info(
          `[runtime-bridge] reconciliation registered ${inserted} new artifact(s) for run ${ctx.runId}`,
        );
      }
    } catch (error) {
      this.deps.logger.error(
        `[runtime-bridge] artifact reconciliation failed for run ${ctx.runId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Register an inbound message that is about to enter (or has already
   * entered) the recipient's transcript as a user-role turn. Called from
   * the prepareRun inbox projection and from `RuntimeMessageInjector` on
   * steer-ack success so the `recordThreadEvent` hook can recover the
   * original author instead of labelling peer messages as the recipient.
   */
  registerInboundInjection(runId: string, record: AgentMessageRecord): void {
    const timestamp = Date.parse(record.createdAt);
    if (!Number.isFinite(timestamp)) return;
    let runMap = this.inboundCorrelations.get(runId);
    if (!runMap) {
      runMap = new Map();
      this.inboundCorrelations.set(runId, runMap);
    }
    runMap.set(timestamp, {
      fromAgentId: record.fromAgentId,
      senderKind: record.senderKind,
      messageId: record.id,
    });
  }

  /** Returns the active run context for a given agent, if any. Used by
   *  main-side services (inbox dispatcher) to decide whether a new inbox
   *  row should route to `agent.steer()` instead of waiting for the next
   *  `prepareRun` cycle. When `requireSteerReady` is set, only runs whose
   *  worker-side Agent is actually subscribed (`agent_active`) are
   *  returned — this avoids steering into `preparing` or `closing` runs
   *  where the steer would be silently dropped. */
  findActiveRunForAgent(
    agentId: string,
    options?: { requireSteerReady?: boolean },
  ): ActiveRunContext | null {
    for (const ctx of this.activeRuns.values()) {
      if (ctx.agentId !== agentId) continue;
      if (options?.requireSteerReady && ctx.state !== "agent_active") continue;
      return ctx;
    }
    return null;
  }

  /**
   * Transition an active run between lifecycle phases as the worker
   * publishes `run-agent-state`. Unknown run ids are ignored: the worker
   * may publish state for a run that main has already evicted when a
   * `run-finished` races ahead of the trailing state message.
   */
  setRunAgentState(runId: string, state: ActiveRunLifecycleState): void {
    const ctx = this.activeRuns.get(runId);
    if (!ctx) return;
    ctx.state = state;
  }

  private getOrCreateStore(taskSessionId: string): SqliteSessionStore {
    const existing = this.sessionStores.get(taskSessionId);
    if (existing) return existing;
    const store = new SqliteSessionStore(this.deps.db, taskSessionId);
    this.sessionStores.set(taskSessionId, store);
    return store;
  }

  /**
   * Resolve a display name for an agent id used in inbox header lines.
   * Falls back to the id when the lookup fails so the transcript remains
   * unambiguous instead of silently rendering "undefined".
   */
  private resolveAgentName(agentId: string): string {
    try {
      const name = this.deps.db.findAgentName(agentId);
      if (name && name.length > 0) return name;
    } catch (error) {
      this.deps.logger.warn(
        `[runtime-bridge] agent name lookup failed for ${agentId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return agentId;
  }

  /** Receives an `agent-event` envelope from the worker; emits to renderer. */
  handleAgentEvent(envelope: {
    runId: string;
    agentId: string;
    companyId: string;
    taskId: string | null;
    emittedAt: string;
    event: { type: string } & Record<string, unknown>;
  }): void {
    this.deps.emitEvent({
      type: "agent-event",
      runId: envelope.runId,
      agentId: envelope.agentId,
      companyId: envelope.companyId,
      taskId: envelope.taskId,
      emittedAt: envelope.emittedAt,
      event: envelope.event,
    });

    const logChunk = projectAgentEventToLogChunk(envelope.event);
    if (logChunk) {
      this.deps.emitEvent({
        type: "run-log",
        runId: envelope.runId,
        stream: logChunk.stream,
        chunk: logChunk.chunk,
      });
    }

    if (envelope.event.type === "message_end") {
      const ctx = this.activeRuns.get(envelope.runId);
      const messageRaw = envelope.event.message as
        | { role?: string; usage?: unknown; content?: unknown; toolCallId?: string; timestamp?: number }
        | undefined;
      if (ctx && messageRaw?.role === "assistant" && messageRaw.usage) {
        try {
          this.costWriter.observeAssistantMessage({
            runId: ctx.runId,
            companyId: ctx.companyId,
            agentId: ctx.agentId,
            taskId: ctx.taskId,
            connectorId: ctx.connectorId,
            modelId: ctx.modelId,
            usage: messageRaw.usage as never,
          });
        } catch (error) {
          this.deps.logger.error(
            `[runtime-bridge] cost recording failed for run ${ctx.runId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      this.recordThreadEvent(envelope, messageRaw);
    }
  }

  /**
   * Project the pi `message_end` event into a `conversation_events` row
   * so renderer thread views stay live. Resolves the thread from the run
   * context: task runs write into the task thread; taskless runs — used
   * by communication wakes — write into a per-agent general thread so
   * peer conversations remain visible in the UI.
   *
   * User-role messages whose pi timestamp matches a registered inbound
   * injection are attributed back to the original author via the
   * correlation map; without that, the envelope's `agentId` (the
   * recipient) would be recorded as the sender and every peer message
   * would collapse into a self-reply row.
   *
   * Best-effort: thread persistence failures must not interrupt the run.
   */
  private recordThreadEvent(
    envelope: { runId: string; agentId: string; companyId: string; taskId: string | null },
    message: { role?: string; content?: unknown; toolCallId?: string; timestamp?: number } | undefined,
  ): void {
    if (!message?.role) return;

    const thread = this.resolveThreadForRun(envelope);
    if (!thread) return;

    try {
      const body = extractTextBody(message.content);
      const actor = this.resolveThreadEventActor(envelope, message);
      this.deps.db.addThreadEvent({
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

  private resolveThreadForRun(
    envelope: { runId: string; agentId: string; companyId: string; taskId: string | null },
  ) {
    if (envelope.taskId) {
      try {
        const task = this.deps.db.getTask(envelope.taskId);
        return ensureTaskThread(this.deps.db, envelope.taskId, envelope.companyId, task.title);
      } catch (error) {
        this.deps.logger.warn(
          `[runtime-bridge] getTask failed for ${envelope.taskId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
      }
    }
    try {
      const agentLabel = this.resolveAgentName(envelope.agentId);
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
      const correlation = this.lookupInboundCorrelation(envelope.runId, message.timestamp);
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

  private lookupInboundCorrelation(
    runId: string,
    timestamp: number | undefined,
  ): InboundCorrelationEntry | null {
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return null;
    const runMap = this.inboundCorrelations.get(runId);
    if (!runMap) return null;
    return runMap.get(timestamp) ?? null;
  }

  /**
   * Write the conversation-event row for an inbound peer message that
   * was projected onto the recipient's transcript as a prior-turn (via
   * `prepareRun`). priorMessages never fire `message_end`, so this is
   * the only path that surfaces them in the thread view. Mid-run steer
   * injections still go through `recordThreadEvent` off `message_end`
   * and resolve their author via `inboundCorrelations`.
   */
  private recordInboundMessageAsThreadEvent(
    envelope: { runId: string; agentId: string; companyId: string; taskId: string | null },
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
      this.deps.db.addThreadEvent({
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

  /** Handles RPC requests issued by the worker (`rpc-request` envelope). */
  async handleRpc(request: {
    rpcId: string;
    method: RpcMethod;
    runId: string;
    payload: unknown;
  }): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
    try {
      switch (request.method) {
        case "persistMessage": {
          const payload = request.payload as { taskSessionId: string; message: AgentMessage };
          this.getOrCreateStore(payload.taskSessionId).appendMessage(payload.message);
          return { ok: true, result: undefined };
        }
        case "prepareRun":
          return await this.handlePrepareRunRpc(request.runId, request.payload);
        case "beforeToolCall":
          return this.handleBeforeToolCallRpc(request.runId, request.payload as BeforeToolCallRpcPayload);
        case "afterToolCall":
          return this.handleAfterToolCallRpc(request.runId, request.payload as AfterToolCallRpcPayload);
        case "transformContext":
          return this.handleTransformContextRpc(request.runId, request.payload as TransformContextRpcPayload);
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async handlePrepareRunRpc(
    runId: string,
    payloadRaw: unknown,
  ): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
    const payload = payloadRaw as {
      connectorId: string;
      taskSessionId: string;
      agentId: string;
      companyId: string;
      taskId: string | null;
      modelId: string;
      workspacePath: string | null;
    };
    this.registerActiveRun({
      runId,
      agentId: payload.agentId,
      companyId: payload.companyId,
      taskId: payload.taskId,
      connectorId: payload.connectorId,
      modelId: payload.modelId,
      taskSessionId: payload.taskSessionId,
      workspacePath: payload.workspacePath,
      state: "preparing",
    });
    const definition = getConnectorDefinition(payload.connectorId);
    const resolved = await this.deps.credentialResolver.resolve(payload.connectorId);

    // Project any pending inbox messages into the session transcript
    // before loading priorMessages — the recipient must observe them
    // as plain user turns in its context. Append fails closed: if
    // persistence throws, the inbox row stays unread and we surface
    // the error so the worker aborts.
    const store = this.getOrCreateStore(payload.taskSessionId);
    const inboxRecords = this.deps.db.listAgentInboxUnread(payload.companyId, payload.agentId);
    for (const record of inboxRecords) {
      const projected = projectInboxMessageToPi(record, {
        getAgentName: (id) => this.resolveAgentName(id),
      });
      store.appendMessage(projected);
      this.registerInboundInjection(runId, record);
      // priorMessages do not fire `message_end`, so write the thread
      // event directly. Steer-injected messages (mid-run) go through
      // `recordThreadEvent` via the pi event loop instead.
      this.recordInboundMessageAsThreadEvent(
        {
          runId,
          agentId: payload.agentId,
          companyId: payload.companyId,
          taskId: payload.taskId,
        },
        record,
      );
    }
    if (inboxRecords.length > 0) {
      this.deps.db.markAgentInboxDelivered(
        payload.agentId,
        inboxRecords.map((r) => r.id),
      );
    }

    const priorMessages = store.loadMessages();
    return {
      ok: true,
      result: {
        provider: definition.provider,
        apiKey: resolved.apiKey,
        extraEnv: resolved.extraEnv ?? {},
        priorMessages,
      },
    };
  }

  private handleBeforeToolCallRpc(
    runId: string,
    payload: BeforeToolCallRpcPayload,
  ): { ok: true; result: unknown } | { ok: false; error: string } {
    const ctx = this.activeRuns.get(runId);
    if (!ctx) {
      return { ok: false, error: `beforeToolCall: no active run ${runId}` };
    }
    const result = handleBeforeToolCall(this.deps, ctx, payload);
    return { ok: true, result };
  }

  private handleAfterToolCallRpc(
    runId: string,
    payload: AfterToolCallRpcPayload,
  ): { ok: true; result: unknown } | { ok: false; error: string } {
    const ctx = this.activeRuns.get(runId);
    if (!ctx) {
      return { ok: false, error: `afterToolCall: no active run ${runId}` };
    }
    const result = handleAfterToolCall(this.deps, ctx, payload);
    return { ok: true, result };
  }

  private handleTransformContextRpc(
    runId: string,
    payload: TransformContextRpcPayload,
  ): { ok: true; result: unknown } | { ok: false; error: string } {
    const ctx = this.activeRuns.get(runId);
    if (!ctx) {
      return { ok: false, error: `transformContext: no active run ${runId}` };
    }
    const result = handleTransformContext(this.deps, ctx, payload);
    return { ok: true, result };
  }
}
