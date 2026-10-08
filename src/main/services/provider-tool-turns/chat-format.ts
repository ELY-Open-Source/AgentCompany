/** OpenAI Chat Completions encoding/decoding (xAI, Groq, Mistral, Cerebras, OpenRouter, Kimi family). */
import { isRecord, ProviderHttpError, type JsonRecord, type ProviderEventStreamMessage } from "../provider-http";
import { FINISHED_STOP_REASONS, parseArguments, replayIn, requireFinished, type AgentTurnMessage, type AgentTurnResult, type AssistantReplay, type ToolCall, type ToolDefinition } from "../provider-tool-turn";

/** Fields providers use for reasoning text; the first non-empty one is the provider's, as in Pi. */
const REASONING_FIELDS = ["reasoning_content", "reasoning", "reasoning_text"] as const;

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
      const replay = replayIn(message, "chat");
      const entry: JsonRecord = { role: "assistant", content: message.text || null, ...(replay ? replay.content as JsonRecord : {}) };
      if (message.toolCalls.length > 0) {
        entry.tool_calls = message.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } }));
      }
      out.push(entry);
    } else {
      for (const result of message.results) {
        out.push({ role: "tool", tool_call_id: result.toolCallId, content: result.output });
      }
      if (message.followUp) out.push({ role: "user", content: message.followUp });
    }
  }
  return out;
}

export function parseChatChoice(data: JsonRecord): { text: string; toolCalls: ToolCall[]; replay?: AssistantReplay } {
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const first = choices.length > 0 && isRecord(choices[0]) ? choices[0] : null;
  requireFinished(first?.finish_reason, FINISHED_STOP_REASONS.chat);
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
  const field = REASONING_FIELDS.find((name) => typeof message[name] === "string" && message[name]);
  const details = Array.isArray(message.reasoning_details) ? message.reasoning_details.filter(isRecord) : [];
  return { text: text.trim(), toolCalls, ...chatReplay(field ? { field, text: message[field] as string } : null, details) };
}

/** Reasoning to send back on the assistant message: the text under its own field, or OpenRouter's structured details. */
function chatReplay(reasoning: { field: string; text: string } | null, details: JsonRecord[]): { replay?: AssistantReplay } {
  if (details.length > 0) return { replay: { format: "chat", content: { reasoning_details: details } } };
  if (reasoning) return { replay: { format: "chat", content: { [reasoning.field]: reasoning.text } } };
  return {};
}

/** OpenRouter streams reasoning details as deltas; consecutive text or summary deltas form one entry, encrypted entries stay whole. */
function appendReasoningDetail(details: JsonRecord[], detail: JsonRecord): void {
  const last = details.at(-1);
  const key = detail.type === "reasoning.text" ? "text" : detail.type === "reasoning.summary" ? "summary" : null;
  if (!key || !last || last.type !== detail.type) {
    details.push({ ...detail });
    return;
  }
  last[key] = String(last[key] ?? "") + String(detail[key] ?? "");
  for (const [name, value] of Object.entries(detail)) if (last[name] === undefined || last[name] === null) last[name] = value;
}

/** Streamed so reasoning models outlive the header deadline; tool calls arrive as indexed fragments, reasoning deltas become the replay. */
export async function accumulateChatStream(messages: AsyncIterable<ProviderEventStreamMessage>): Promise<AgentTurnResult> {
  const raw: string[] = [];
  const textParts: string[] = [];
  const fragments = new Map<number, { id: string; name: string; args: string }>();
  const reasoning = { field: "", text: "" };
  const details: JsonRecord[] = [];
  let finishReason: unknown = null;
  for await (const message of messages) {
    raw.push(message.rawData);
    if (message.data.error !== undefined) throw new ProviderHttpError(streamErrorText(message.data.error), null, streamErrorStatus(message.data.error));
    const choices = Array.isArray(message.data.choices) ? message.data.choices : [];
    const first = choices.length > 0 && isRecord(choices[0]) ? choices[0] : null;
    if (first && typeof first.finish_reason === "string") finishReason = first.finish_reason;
    const delta = first && isRecord(first.delta) ? first.delta : null;
    if (!delta) continue;
    if (typeof delta.content === "string") textParts.push(delta.content);
    const field = REASONING_FIELDS.find((name) => typeof delta[name] === "string" && delta[name]);
    if (field) Object.assign(reasoning, { field: reasoning.field || field, text: reasoning.text + (delta[field] as string) });
    if (Array.isArray(delta.reasoning_details)) for (const detail of delta.reasoning_details.filter(isRecord)) appendReasoningDetail(details, detail);
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
  requireFinished(finishReason, FINISHED_STOP_REASONS.chat);
  const toolCalls: ToolCall[] = [];
  for (const [, fragment] of [...fragments.entries()].sort(([a], [b]) => a - b)) {
    if (fragment.id && fragment.name) toolCalls.push({ id: fragment.id, name: fragment.name, arguments: parseArguments(fragment.args) });
  }
  return { text: textParts.join("").trim(), toolCalls, rawResponseJson: JSON.stringify(raw), ...chatReplay(reasoning.field ? reasoning : null, details) };
}

/** An in-stream error object's HTTP-style code (OpenRouter sends e.g. { code: 500 }), or null. */
function streamErrorStatus(error: unknown): number | null {
  return isRecord(error) && typeof error.code === "number" ? error.code : null;
}

function streamErrorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return "Provider stream failed.";
}
