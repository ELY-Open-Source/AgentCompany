import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AppDatabase } from "@main/database";
import type { DesktopEvent } from "@shared/types";
import { ensureTaskThread } from "@main/thread-integration/thread-helpers";
import { SqliteSessionStore } from "./sqlite-session-store";
import { HumanApprovalHook } from "./approval-hook";
import { CostWriter } from "./cost-writer";
import type { CredentialResolver } from "@main/credentials";
import { getConnectorDefinition } from "@main/connectors";

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
 * - Translates `beforeToolCall` RPC into an approval row + waits.
 * - Translates `afterToolCall` RPC into best-effort audit hooks.
 */
export class RuntimeBridge {
  readonly approvalHook: HumanApprovalHook;
  private readonly costWriter: CostWriter;
  private readonly activeRuns = new Map<string, ActiveRunContext>();
  private readonly sessionStores = new Map<string, SqliteSessionStore>();

  constructor(private readonly deps: RuntimeBridgeDeps) {
    this.approvalHook = new HumanApprovalHook({
      db: deps.db,
      emitEvent: deps.emitEvent,
      logger: deps.logger,
    });
    this.costWriter = new CostWriter({ db: deps.db, logger: deps.logger });
  }

  registerActiveRun(context: ActiveRunContext): void {
    this.activeRuns.set(context.runId, context);
    this.getOrCreateStore(context.taskSessionId);
  }

  releaseActiveRun(runId: string): void {
    this.activeRuns.delete(runId);
  }

  loadPriorMessages(taskSessionId: string): AgentMessage[] {
    return this.getOrCreateStore(taskSessionId).loadMessages();
  }

  private getOrCreateStore(taskSessionId: string): SqliteSessionStore {
    const existing = this.sessionStores.get(taskSessionId);
    if (existing) return existing;
    const store = new SqliteSessionStore(this.deps.db, taskSessionId);
    this.sessionStores.set(taskSessionId, store);
    return store;
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
        this.costWriter.observeAssistantMessage({
          runId: ctx.runId,
          companyId: ctx.companyId,
          agentId: ctx.agentId,
          taskId: ctx.taskId,
          connectorId: ctx.connectorId,
          modelId: ctx.modelId,
          usage: messageRaw.usage as never,
        });
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
    } catch {
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
    method: "beforeToolCall" | "afterToolCall" | "persistMessage" | "prepareRun";
    runId: string;
    payload: unknown;
  }): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
    try {
      if (request.method === "beforeToolCall") {
        const ctx = this.activeRuns.get(request.runId);
        if (!ctx) return { ok: true, result: {} };
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
      if (request.method === "afterToolCall") {
        const payload = request.payload as { toolCallId: string; toolName: string; isError: boolean };
        await this.approvalHook.after(request.runId, payload);
        return { ok: true, result: undefined };
      }
      if (request.method === "persistMessage") {
        const payload = request.payload as { taskSessionId: string; message: AgentMessage };
        this.getOrCreateStore(payload.taskSessionId).appendMessage(payload.message);
        return { ok: true, result: undefined };
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
        const priorMessages = this.getOrCreateStore(payload.taskSessionId).loadMessages();
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
