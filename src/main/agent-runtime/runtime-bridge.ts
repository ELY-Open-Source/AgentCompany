import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AppDatabase } from "@main/database";
import type { AgentMessageRecord, DesktopEvent } from "@shared/types";
import { SqliteSessionStore } from "./sqlite-session-store";
import { CostWriter } from "./cost-writer";
import type { CredentialResolver } from "@main/credentials";
import { getConnectorDefinition } from "@main/connectors";
import { projectInboxMessageToPi } from "./inbox-projection";
import { projectAgentEventToLogChunk } from "./agent-event-projection";
import { hasAttributableAssistantUsage } from "../run-usage-status";
import { captureBaselineIfRequired } from "./artifact-projector";
import {
  reconcileArtifactsForActiveRun,
  type RunResourceReleaseResult,
} from "./runtime-artifact-reconciler";
import {
  handleBeforeToolCall,
  handleAfterToolCall,
  type ActiveRunContext,
  type ActiveRunLifecycleState,
} from "./hook-handlers";
import type {
  AfterToolCallRpcPayload,
  BeforeToolCallRpcPayload,
} from "./hook-rpc";
import { routeInternalToolCall } from "./internal-tools/router";
import type { InvokeInternalToolRpcPayload } from "@main/worker/runtime/internal-tools/internal-tool-rpc";
import { InboundCorrelationRegistryStore } from "./inbound-correlation-registry";
import { RuntimeThreadProjector } from "./runtime-thread-projector";

/**
 * Side-effect callbacks the internal-tool handlers invoke after a
 * successful DB write. These come from the same wire-api-server fabric
 * the HTTP routes funnel through, so thread integration / automation /
 * renderer domain-change notifications stay identical across both
 * entry points. Supplied lazily via `setInternalToolCallbacks` because
 * the graph builds `RuntimeBridge` before the orchestration/thread-
 * integration layer exists.
 */
export interface InternalToolCallbacks {
  onApprovalCreated: (
    approvalId: string,
    companyId: string,
    taskId: string | null,
    approvalType: string,
    summary: string,
  ) => void;
  onApprovalResolved: (
    approvalId: string,
    companyId: string,
    decision: string,
  ) => void;
  onDomainChanged: () => void;
}

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

// Derived from the zod schema in `worker/entry/types.ts` so there is
// exactly one source of truth for the RPC method name list. The C4→C5
// hotfix (9d9f003) showed what happens when this union and the zod
// enum drift — worker emits a new method, handler accepts it, and the
// runtime gate silently rejects the envelope. `z.infer` plus a
// compile-time `satisfies` check below makes that category of drift
// a TypeScript error rather than a production ZodError.
import type { WorkerRpcMethod } from "@main/worker/entry/types";

type RpcMethod = WorkerRpcMethod;

/**
 * Single owner of pi runtime side-effects in main.
 *
 * - Forwards `agent-event` from the worker to the renderer (push channel).
 * - Persists each `message_end` message via `SqliteSessionStore`.
 * - Calls `CostWriter` for assistant messages with usage.
 * - Proxies pi's tool-execution hooks (`beforeToolCall` / `afterToolCall`)
 *   into policy handlers: approval-gate checks and filesystem artifact
 *   projection.
 *
 * Policy itself lives in `hook-handlers.ts`; this class is a pure IPC
 * router plus an `ActiveRunContext` cache.
 */
export class RuntimeBridge {
  private readonly costWriter: CostWriter;
  private readonly threadProjector: RuntimeThreadProjector;
  private readonly activeRuns = new Map<string, ActiveRunContext>();
  private readonly sessionStores = new Map<string, SqliteSessionStore>();
  private internalToolCallbacks: InternalToolCallbacks | null = null;
  private readonly inboundCorrelations = new InboundCorrelationRegistryStore();

  constructor(private readonly deps: RuntimeBridgeDeps) {
    this.costWriter = new CostWriter({ db: deps.db });
    this.threadProjector = new RuntimeThreadProjector({
      db: deps.db,
      logger: deps.logger,
      resolveAgentName: (agentId) => this.resolveAgentName(agentId),
      lookupInboundCorrelation: (runId, timestamp) =>
        this.inboundCorrelations.lookup(runId, timestamp),
    });
  }

  /**
   * Late-bind the side-effect callbacks used by the internal-tool
   * router. The graph must call this exactly once before any tool
   * invocation fires; missing callbacks at RPC time throw rather than
   * silently skipping the notification, so a wiring regression surfaces
   * on the first tool call instead of as a stale-UI ghost.
   */
  setInternalToolCallbacks(callbacks: InternalToolCallbacks): void {
    if (this.internalToolCallbacks) {
      throw new Error("RuntimeBridge.setInternalToolCallbacks called twice.");
    }
    this.internalToolCallbacks = callbacks;
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
  releaseRunResources(runId: string): RunResourceReleaseResult {
    const ctx = this.activeRuns.get(runId);
    let result: RunResourceReleaseResult = { ok: true };
    try {
      if (ctx) result = this.reconcileArtifactsForRun(ctx);
      return result;
    } finally {
      this.activeRuns.delete(runId);
      this.inboundCorrelations.deleteRun(runId);
      if (ctx) this.sessionStores.delete(ctx.taskSessionId);
    }
  }

  private reconcileArtifactsForRun(ctx: ActiveRunContext): RunResourceReleaseResult {
    return reconcileArtifactsForActiveRun(this.deps, ctx);
  }

  /**
   * Build the pi projection for an inbound message and register the
   * correlation under `record.id`. Returns the projected user turn so
   * callers (the prepareRun inbox loop, the runtime message injector)
   * append / steer the same object that the bridge has indexed.
   *
   * A monotonically increasing `piTimestamp` is stamped onto the
   * returned message so two inbound rows that share the same
   * wall-clock millisecond still resolve to distinct correlation
   * entries when `message_end` fires.
   */
  projectInboundMessage(runId: string, record: AgentMessageRecord): AgentMessage {
    const base = Date.parse(record.createdAt);
    const baseline = Number.isFinite(base) ? base : Date.now();
    const allocated = this.inboundCorrelations.register(runId, record, baseline);
    return projectInboxMessageToPi(record, {
      getAgentName: (id) => this.resolveAgentName(id),
    }, { timestampOverride: allocated });
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
      const name = this.deps.db.core.agents.findAgentName(agentId);
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
        | {
            role?: string;
            stopReason?: string;
            usage?: { input?: unknown; output?: unknown };
            content?: unknown;
            toolCallId?: string;
            timestamp?: number;
          }
        | undefined;
      if (ctx && hasAttributableAssistantUsage(messageRaw)) {
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
      this.threadProjector.recordThreadEvent(envelope, messageRaw);
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
        case "invokeInternalTool":
          return this.handleInvokeInternalToolRpc(request.runId, request.payload as InvokeInternalToolRpcPayload);
        default: {
          // Exhaustiveness guard. If `WorkerRpcMethod` widens in
          // `worker/entry/types.ts` without a corresponding case here,
          // the assignment to `never` is a TypeScript error — which is
          // exactly what we want so the C4→C5 drift category cannot
          // silently recur at runtime.
          const _exhaustive: never = request.method;
          return { ok: false, error: `unknown RPC method: ${String(_exhaustive)}` };
        }
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private handleInvokeInternalToolRpc(
    runId: string,
    payload: InvokeInternalToolRpcPayload,
  ): { ok: true; result: unknown } | { ok: false; error: string } {
    const ctx = this.activeRuns.get(runId);
    if (!ctx) {
      return { ok: false, error: `invokeInternalTool: no active run ${runId}` };
    }
    const callbacks = this.internalToolCallbacks;
    if (!callbacks) {
      return {
        ok: false,
        error: "invokeInternalTool: internal-tool callbacks not wired — service graph init regression.",
      };
    }
    const result = routeInternalToolCall(
      {
        hireAgent: {
          db: this.deps.db,
          onApprovalResolved: callbacks.onApprovalResolved,
          onDomainChanged: callbacks.onDomainChanged,
          logger: this.deps.logger,
        },
        fileApproval: {
          db: this.deps.db,
          onApprovalCreated: callbacks.onApprovalCreated,
          onApprovalResolved: callbacks.onApprovalResolved,
          onDomainChanged: callbacks.onDomainChanged,
          logger: this.deps.logger,
        },
      },
      { companyId: ctx.companyId, agentId: ctx.agentId },
      payload,
    );
    return { ok: true, result };
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
      workspaceId: string | null;
      workspacePath: string | null;
      workspaceMode: "exclusive" | "shared" | "none";
    };
    const baseline = captureBaselineIfRequired(payload.workspacePath, this.deps.logger);
    this.registerActiveRun({
      runId,
      agentId: payload.agentId,
      companyId: payload.companyId,
      taskId: payload.taskId,
      connectorId: payload.connectorId,
      modelId: payload.modelId,
      taskSessionId: payload.taskSessionId,
      workspaceId: payload.workspaceId,
      workspacePath: payload.workspacePath,
      workspaceMode: payload.workspaceMode,
      workspaceBaseline: baseline,
      state: "preparing",
    });
    const definition = getConnectorDefinition(payload.connectorId);
    const resolved = await this.deps.credentialResolver.resolve(payload.connectorId);

    // Project any pending inbox messages into the session transcript
    // before loading priorMessages — the recipient must observe them
    // as plain user turns in its context.
    //
    // Replay safety lives entirely on the `agent_message_projections`
    // ledger. "We put the message into the agent's transcript" and
    // "the agent has acknowledged the message" are two different
    // facts, tracked in two different tables: projections are append-
    // only on dispatch, while reads are inserted into
    // `agent_message_reads` only when the agent POSTs
    // /messages/{id}/read. Conflating the two (as an earlier build
    // that wrote to `agent_messages.read_at` at projection time did)
    // made every projected message immediately invisible to
    // `?unreadOnly=true`, so agents posted status comments instead of
    // replies. The explicit read endpoint is the sole signal.
    const store = this.getOrCreateStore(payload.taskSessionId);
    const inboxRecords = this.deps.db.core.messages.listAgentInboxUnread(payload.companyId, payload.agentId);
    if (inboxRecords.length > 0) {
      this.deps.db.withTransaction(() => {
        for (const record of inboxRecords) {
          const claimed = this.deps.db.projection.inbox.claimProjection(record.id, payload.taskSessionId);
          if (!claimed) continue;
          // `projectInboundMessage` allocates a monotonic pi-timestamp
          // and indexes the correlation under `record.id`. Two rows
          // that share the same wall-clock millisecond still resolve
          // to distinct authors at `message_end`.
          const projected = this.projectInboundMessage(runId, record);
          store.appendMessage(projected);
          this.threadProjector.recordInboundMessageAsThreadEvent(
            {
              runId,
              agentId: payload.agentId,
              companyId: payload.companyId,
              taskId: payload.taskId,
            },
            record,
          );
        }
      });
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

}
