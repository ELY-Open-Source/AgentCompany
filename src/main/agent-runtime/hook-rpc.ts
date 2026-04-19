/**
 * Hook RPC contracts — the parent↔worker half of pi-agent-core's
 * `beforeToolCall` / `afterToolCall` / `transformContext` hooks.
 *
 * The Agent instance lives in the utility process. Policy (approval,
 * compaction, filesystem projection) lives in main. The hooks are
 * therefore proxied: the worker invokes an RPC that main answers from
 * the same `RuntimeBridge` that already owns agent-event and
 * `persistMessage` handling.
 *
 * Payloads intentionally exclude pi's `AgentContext` (systemPrompt,
 * messages, tools) because main policy never needs it. Stripping it
 * keeps each hook IPC well under the structured-clone budget even for
 * large transcripts.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";

// ─── beforeToolCall ───────────────────────────────────────────────────────

export interface BeforeToolCallRpcPayload {
  toolName: string;
  toolCallId: string;
  args: unknown;
}

export interface BeforeToolCallRpcResult {
  block: boolean;
  reason: string | null;
}

// ─── afterToolCall ────────────────────────────────────────────────────────

export interface AfterToolCallRpcPayload {
  toolName: string;
  toolCallId: string;
  args: unknown;
  /** Raw tool result content list as emitted by pi's tool executor. */
  resultContent: unknown;
  /** Structured `details` payload if the tool exposed one. */
  resultDetails: unknown;
  isError: boolean;
}

/**
 * Optional override for the executed tool result, mirroring pi's
 * `AfterToolCallResult` shape. Main returns every field as `null` when
 * the hook performs observation only (current projection use-case).
 */
export interface AfterToolCallRpcResult {
  contentOverride: { type: "text"; text: string }[] | null;
  isErrorOverride: boolean | null;
}

// ─── transformContext ─────────────────────────────────────────────────────

export interface TransformContextRpcPayload {
  messages: AgentMessage[];
}

export interface TransformContextRpcResult {
  /**
   * Transformed transcript. When `changed` is false the worker keeps its
   * original array instance instead of replacing it — saves structured
   * clone on the common "no compaction yet" path.
   */
  changed: boolean;
  messages: AgentMessage[] | null;
}
