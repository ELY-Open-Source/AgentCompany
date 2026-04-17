import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AppDatabase } from "@main/database";
import type { DesktopEvent } from "@shared/types";
import { ensureTaskThread } from "@main/thread-integration/thread-helpers";
import { SqliteSessionStore } from "./sqlite-session-store";
import { CostWriter } from "./cost-writer";
import { HumanApprovalHook } from "./approval-hook";
import type { CredentialResolver } from "@main/credentials";
import { getConnectorDefinition } from "@main/connectors";
import { projectInboxMessageToPi } from "./inbox-projection";

/**
 * Projects a pi AgentEvent to a human-readable log line for the Console.
 * See pi-mono-reference/packages/agent/src/types.ts `AgentEvent` for the
 * canonical union shape; this projection handles every type that carries
 * user-visible activity.
 */
function projectAgentEventToLogChunk(
  event: { type: string } & Record<string, unknown>,
): { stream: "stdout" | "stderr"; chunk: string } | null {
  switch (event.type) {
    case "agent_start":
      return { stream: "stdout", chunk: "\n[agent:start]\n" };
    case "turn_start":
      return { stream: "stdout", chunk: "\n" };
    case "turn_end":
      return { stream: "stdout", chunk: "\n" };
    case "message_start": {
      const message = event.message as { role?: string; content?: unknown } | undefined;
      if (message?.role === "user") {
        const body = extractMessageText(message);
        if (!body) return null;
        return { stream: "stdout", chunk: `[user] ${body}\n` };
      }
      return null;
    }
    case "message_update": {
      // Streaming assistant deltas — `assistantMessageEvent.type` carries
      // the intra-turn stream protocol from pi-ai (text_delta /
      // thinking_delta / toolcall_start / ...). We surface text and
      // thinking deltas verbatim so the Console shows live output.
      const inner = event.assistantMessageEvent as
        | ({ type?: string; delta?: string; content?: string } & Record<string, unknown>)
        | undefined;
      if (!inner) return null;
      if (inner.type === "text_delta" && typeof inner.delta === "string" && inner.delta.length > 0) {
        return { stream: "stdout", chunk: inner.delta };
      }
      if (inner.type === "thinking_delta" && typeof inner.delta === "string" && inner.delta.length > 0) {
        return { stream: "stdout", chunk: inner.delta };
      }
      return null;
    }
    case "message_end": {
      // The final assistant message is already fully rendered via
      // preceding message_update deltas; emit a trailing newline so the
      // next turn starts on its own line.
      return { stream: "stdout", chunk: "\n" };
    }
    case "tool_execution_start": {
      const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
      const argsPreview = summariseJson(event.args, 200);
      return { stream: "stdout", chunk: `\n[tool:${toolName}] ${argsPreview}\n` };
    }
    case "tool_execution_end": {
      const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
      const isError = event.isError === true;
      const resultPreview = summariseJson(event.result, 300);
      const tag = isError ? "tool:error" : "tool:done";
      return { stream: isError ? "stderr" : "stdout", chunk: `[${tag}:${toolName}] ${resultPreview}\n` };
    }
    case "agent_end":
      return { stream: "stdout", chunk: "\n[agent:end]\n" };
    default:
      return null;
  }
}

/**
 * Pulls plain text out of a pi AgentMessage's content array. User messages
 * carry `content: [{ type: "text", text: "..." }]` per pi's AgentMessage
 * schema; other content types (image, tool_result, etc.) are ignored here.
 */
function extractMessageText(message: { content?: unknown }): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
      const text = (block as { text?: string }).text;
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.join("");
}

function summariseJson(value: unknown, maxLength: number): string {
  if (value === undefined || value === null) return "";
  try {
    const json = typeof value === "string" ? value : JSON.stringify(value);
    if (json.length <= maxLength) return json;
    return `${json.slice(0, maxLength - 3)}...`;
  } catch {
    return "<unserialisable>";
  }
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

interface ActiveRunContext {
  runId: string;
  agentId: string;
  companyId: string;
  taskId: string | null;
  connectorId: string;
  modelId: string;
  taskSessionId: string;
}

/**
 * Single owner of pi runtime side-effects in main.
 *
 * - Forwards `agent-event` from the worker to the renderer (push channel).
 * - Persists each `message_end` message via `SqliteSessionStore`.
 * - Calls `CostWriter` for assistant messages with usage.
 * - Hosts `HumanApprovalHook` for Co-Founder mode tool gating; the worker
 *   only invokes the hook RPC when running in `ai_cofounder` mode, so
 *   CEO-mode runs pay zero IPC overhead.
 */
export class RuntimeBridge {
  readonly approvalHook: HumanApprovalHook;
  private readonly costWriter: CostWriter;
  private readonly activeRuns = new Map<string, ActiveRunContext>();
  private readonly sessionStores = new Map<string, SqliteSessionStore>();

  constructor(private readonly deps: RuntimeBridgeDeps) {
    this.costWriter = new CostWriter({ db: deps.db });
    this.approvalHook = new HumanApprovalHook({
      db: deps.db,
      emitEvent: deps.emitEvent,
      logger: deps.logger,
    });
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
          // Cost writer fails closed (RUNTIME-105) — surface the failure
          // loudly so operators can see a pricing catalog break, but let
          // the run continue so the agent's work is not lost. The missing
          // row means budget enforcement under-counts this message; a
          // repeated failure in the same run is still visible in logs.
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
      const actorType: "agent" | "user" | "system" = message.role === "user"
        ? "user"
        : message.role === "assistant"
          ? "agent"
          : "system";
      this.deps.db.addThreadEvent({
        threadId: thread.id,
        actorId: envelope.agentId,
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
    method: "persistMessage" | "prepareRun" | "beforeToolCall";
    runId: string;
    payload: unknown;
  }): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
    try {
      if (request.method === "persistMessage") {
        const payload = request.payload as { taskSessionId: string; message: AgentMessage };
        this.getOrCreateStore(payload.taskSessionId).appendMessage(payload.message);
        return { ok: true, result: undefined };
      }
      if (request.method === "beforeToolCall") {
        const payload = request.payload as {
          agentId: string;
          companyId: string;
          taskId: string | null;
          toolCallId: string;
          toolName: string;
          args: unknown;
        };
        const verdict = await this.approvalHook.before(request.runId, payload);
        return { ok: true, result: verdict };
      }
      if (request.method === "prepareRun") {
        const payload = request.payload as {
          connectorId: string;
          taskSessionId: string;
          agentId: string;
          companyId: string;
          taskId: string | null;
          modelId: string;
        };
        this.registerActiveRun({
          runId: request.runId,
          agentId: payload.agentId,
          companyId: payload.companyId,
          taskId: payload.taskId,
          connectorId: payload.connectorId,
          modelId: payload.modelId,
          taskSessionId: payload.taskSessionId,
        });
        const definition = getConnectorDefinition(payload.connectorId);
        const resolved = await this.deps.credentialResolver.resolve(payload.connectorId);

        // Project any pending inbox messages into the session transcript
        // *before* loading priorMessages — the recipient must observe them
        // as plain user turns in its context, and the transcript row is
        // the single source of memory (recentMessages prompt block is
        // gone). Append fails closed: if persistence throws, the inbox
        // row stays unread and we surface the error so the worker aborts.
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
      return { ok: false, error: `Unknown RPC method: ${(request as { method: string }).method}` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

/** Best-effort textual rendering of a pi message's content for thread rows. */
function extractTextBody(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const obj = block as { type?: string; text?: string; thinking?: string; name?: string };
    if (obj.type === "text" && typeof obj.text === "string") parts.push(obj.text);
    else if (obj.type === "thinking" && typeof obj.thinking === "string") parts.push(`[thinking] ${obj.thinking}`);
    else if (obj.type === "toolCall" && typeof obj.name === "string") parts.push(`[tool:${obj.name}]`);
  }
  return parts.join("\n").trim();
}
