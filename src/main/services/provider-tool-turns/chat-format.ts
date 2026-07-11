/** OpenAI Chat Completions encoding/decoding (xAI, Groq, Mistral, Cerebras, OpenRouter, Kimi family). */
import { isRecord, type JsonRecord, type ProviderEventStreamMessage } from "../provider-http";
import { parseArguments, type AgentTurnMessage, type AgentTurnResult, type ToolCall, type ToolDefinition } from "../provider-tool-turn";

export function chatToolDefs(tools: ToolDefinition[]): unknown[] {
  return tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
}

export function toChatMessages(instructions: string | null, messages: AgentTurnMessage[]): unknown[] {
  const out: unknown[] = [];
  if (instructions) out.push({ role: "system", content: instructions });
  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: message.text });
    } else if (message.role === "assistant") {
      const entry: JsonRecord = { role: "assistant", content: message.text || null };
      if (message.toolCalls.length > 0) {
        entry.tool_calls = message.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } }));
      }
      out.push(entry);
    } else {
      for (const result of message.results) {
        out.push({ role: "tool", tool_call_id: result.toolCallId, content: result.output });
      }
    }
  }
  return out;
}

export function parseChatChoice(data: JsonRecord): { text: string; toolCalls: ToolCall[] } {
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const first = choices.length > 0 && isRecord(choices[0]) ? choices[0] : null;
  const message = first && isRecord(first.message) ? first.message : null;
  if (!message) return { text: "", toolCalls: [] };
  const text = typeof message.content === "string" ? message.content : "";
  const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const toolCalls: ToolCall[] = [];
  for (const call of rawCalls) {
    if (!isRecord(call)) continue;
    const fn = isRecord(call.function) ? call.function : null;
    const id = typeof call.id === "string" ? call.id : "";
    const name = fn && typeof fn.name === "string" ? fn.name : "";
    if (id && name) toolCalls.push({ id, name, arguments: parseArguments(fn?.arguments) });
  }
  return { text: text.trim(), toolCalls };
}

/**
 * Accumulate a Chat Completions SSE stream into the final turn result.
 *
 * Streaming here is load-bearing, not cosmetic: reasoning models (the Kimi
 * family) can think well past the 60s header deadline before a buffered
 * response would start, so the turn must consume deltas as they arrive and
 * let the stream idle deadline govern instead. Tool calls arrive as indexed
 * fragments — the opening chunk of a call carries id and name, later chunks
 * append argument text. Usage-only chunks have no choices; reasoning_content
 * deltas keep the stream alive but are not part of the result.
 */
export async function accumulateChatStream(messages: AsyncIterable<ProviderEventStreamMessage>): Promise<AgentTurnResult> {
  const raw: string[] = [];
  const textParts: string[] = [];
  const fragments = new Map<number, { id: string; name: string; args: string }>();
  for await (const message of messages) {
    raw.push(message.rawData);
    if (message.data.error !== undefined) throw new Error(streamErrorText(message.data.error));
    const choices = Array.isArray(message.data.choices) ? message.data.choices : [];
    const first = choices.length > 0 && isRecord(choices[0]) ? choices[0] : null;
    const delta = first && isRecord(first.delta) ? first.delta : null;
    if (!delta) continue;
    if (typeof delta.content === "string") textParts.push(delta.content);
    const calls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    for (const call of calls) {
      if (!isRecord(call)) continue;
      const index = typeof call.index === "number" ? call.index : fragments.size;
      const fragment = fragments.get(index) ?? { id: "", name: "", args: "" };
      if (typeof call.id === "string" && call.id) fragment.id = call.id;
      const fn = isRecord(call.function) ? call.function : null;
      if (fn && typeof fn.name === "string" && fn.name) fragment.name = fn.name;
      if (fn && typeof fn.arguments === "string") fragment.args += fn.arguments;
      fragments.set(index, fragment);
    }
  }
  if (raw.length === 0) throw new Error("Chat completions stream ended without any events.");
  const toolCalls: ToolCall[] = [];
  for (const [, fragment] of [...fragments.entries()].sort(([a], [b]) => a - b)) {
    if (fragment.id && fragment.name) toolCalls.push({ id: fragment.id, name: fragment.name, arguments: parseArguments(fragment.args) });
  }
  return { text: textParts.join("").trim(), toolCalls, rawResponseJson: JSON.stringify(raw) };
}

function streamErrorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return "Provider stream failed.";
}
