/**
 * Hook RPC contracts — the parent↔worker half of pi-agent-core's
 * `beforeToolCall` hook.
 *
 * The Agent instance lives in the utility process. Approval policy
 * lives in main. The hook is therefore proxied: the worker invokes an
 * RPC that main answers from the same `RuntimeBridge` that already owns
 * agent-event and `persistMessage` handling. Context compaction runs in
 * the worker process and reports telemetry through a worker message.
 *
 * Payloads intentionally exclude pi's `AgentContext` (systemPrompt,
 * messages, tools) because main policy only needs the tool call. This
 * keeps the hook IPC well under the structured-clone budget even for
 * large transcripts.
 */
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
