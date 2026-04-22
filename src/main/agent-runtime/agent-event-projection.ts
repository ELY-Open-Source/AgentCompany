/**
 * Pure projection helpers for pi AgentEvent → human-readable console log.
 *
 * Extracted from runtime-bridge.ts to keep the bridge under the 400-line
 * cap. These functions never touch DB, IPC, or filesystem — they are
 * deterministic text transforms and must stay that way. New event
 * types are added here; the bridge pipes the result into its run-log
 * stream.
 *
 * The `@mariozechner/pi-agent-core` `AgentEvent` union is the
 * canonical shape we project.
 */

export type AgentEventLogChunk = { stream: "stdout" | "stderr"; chunk: string };

/**
 * Extract plain text from a pi AgentMessage's content array. User
 * messages carry `content: [{ type: "text", text: "..." }]`; other
 * content types (image, tool_result, thinking) are filtered out.
 */
export function extractMessageText(message: { content?: unknown }): string {
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

/**
 * Compact JSON preview used in tool-execution log lines. Falls back to a
 * sentinel when the value cannot be serialised (circular refs etc.).
 */
export function summariseJson(value: unknown, maxLength: number): string {
  if (value === undefined || value === null) return "";
  try {
    const json = typeof value === "string" ? value : JSON.stringify(value);
    if (json.length <= maxLength) return json;
    return `${json.slice(0, maxLength - 3)}...`;
  } catch {
    return "<unserialisable>";
  }
}

/**
 * Best-effort textual rendering of a pi message's content for thread
 * rows. Handles text, thinking, and toolCall blocks; returns an empty
 * string for purely structural payloads so the thread view does not
 * show noise.
 */
export function extractTextBody(content: unknown): string {
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

/**
 * Project a pi AgentEvent to a single console log chunk. Returns null
 * for events that should not appear in the log (e.g., streaming
 * deltas whose content is already rendered upstream).
 */
export function projectAgentEventToLogChunk(
  event: { type: string } & Record<string, unknown>,
): AgentEventLogChunk | null {
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
