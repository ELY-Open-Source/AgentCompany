import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AppDatabase } from "@main/database";
import type { DesktopEvent } from "@shared/types";
import { ensureTaskThread } from "@main/thread-integration/thread-helpers";
import { SqliteSessionStore } from "./sqlite-session-store";
import { CostWriter } from "./cost-writer";
import type { CredentialResolver } from "@main/credentials";
import { getConnectorDefinition } from "@main/connectors";
import { projectInboxMessageToPi } from "./inbox-projection";
import { projectAgentEventToLogChunk, extractTextBody } from "./agent-event-projection";
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
export class RuntimeBridge {
  private readonly costWriter: CostWriter;
  private readonly activeRuns = new Map<string, ActiveRunContext>();
  private readonly sessionStores = new Map<string, SqliteSessionStore>();

  constructor(private readonly deps: RuntimeBridgeDeps) {
    this.costWriter = new CostWriter({ db: deps.db });
  }

  private registerActiveRun(context: ActiveRunContext): void {
    this.activeRuns.set(context.runId, context);
    this.getOrCreateStore(context.taskSessionId);
  }

  /**
   * Evicts the per-run `activeRuns` context and the per-session store cache.
   * Callers must invoke after a `run-finished` worker message so the maps
   * stay bounded by concurrent-run count rather than process lifetime.
   */
  releaseRunResources(runId: string): void {
    const ctx = this.activeRuns.get(runId);
    this.activeRuns.delete(runId);
    if (ctx) this.sessionStores.delete(ctx.taskSessionId);
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
        | { role?: string; usage?: unknown; content?: unknown; toolCallId?: string }
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
   * Project the pi `message_end` event into the task thread as a
   * `conversation_events` row so renderer thread views stay live.
   * Best-effort: thread persistence failures must not interrupt the run.
   */
  private recordThreadEvent(
    envelope: { runId: string; agentId: string; companyId: string; taskId: string | null },
    message: { role?: string; content?: unknown; toolCallId?: string } | undefined,
  ): void {
    if (!envelope.taskId || !message?.role) return;
    let task: { title: string } | null = null;
    try {
      task = this.deps.db.getTask(envelope.taskId);
    } catch (err) {
      this.deps.logger.warn(`[runtime-bridge] getTask failed for ${envelope.taskId} in recordThreadEvent:`, err instanceof Error ? err.message : String(err));
      return;
    }
    if (!task) return;
    try {
      const thread = ensureTaskThread(this.deps.db, envelope.taskId, envelope.companyId, task.title);
      const body = extractTextBody(message.content);
      const isUserMessage = message.role === "user";
      const actorType: "agent" | "user" | "system" = isUserMessage
        ? "user"
        : message.role === "assistant"
          ? "agent"
          : "system";
      // User-role messages inside the transcript come from either a human
      // (inbox projection → Board/User) or a peer agent (via steer). The
      // envelope's agentId is the *recipient*, never the author; recording
      // it there creates fake "CEO replied to CEO" rows. For user-authored
      // rows we record the virtual user actor id; peer-authored user rows
      // are labeled "system" since pi has already erased the sender.
      const actorId = isUserMessage ? "user" : envelope.agentId;
      this.deps.db.addThreadEvent({
        threadId: thread.id,
        actorId,
        actorType,
        eventType: message.role === "toolResult" ? "system_note" : "message",
        body: body.length > 4000 ? `${body.slice(0, 3997)}...` : body,
        metadataJson: JSON.stringify({ runId: envelope.runId, role: message.role }),
      });
    } catch (error) {
      this.deps.logger.warn(
        `[runtime-bridge] failed to project agent-event into thread for task ${envelope.taskId}: ${
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
