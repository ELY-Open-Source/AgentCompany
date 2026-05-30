/**
 * OpenAI Responses API encoding/decoding, shared by the openai, gpt-account
 * (Codex) and github-copilot turns. Matches Pi's `convertResponsesMessages` /
 * `convertResponsesTools` and the Responses streaming event shapes.
 */
import { isRecord, type JsonRecord, type ProviderEventStreamMessage } from "../provider-http";
import { parseArguments, type AgentTurnMessage, type AgentTurnResult, type ToolCall, type ToolDefinition } from "../provider-tool-turn";

export function responsesToolDefs(tools: ToolDefinition[], strict: boolean | null = false): unknown[] {
  return tools.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters, strict }));
}

export function toResponsesInput(messages: AgentTurnMessage[]): unknown[] {
  const items: unknown[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      items.push({ role: "user", content: [{ type: "input_text", text: message.text }] });
    } else if (message.role === "assistant") {
      if (message.text) {
        items.push({ type: "message", role: "assistant", content: [{ type: "output_text", text: message.text, annotations: [] }] });
      }
      for (const call of message.toolCalls) {
        items.push({ type: "function_call", call_id: call.id, name: call.name, arguments: JSON.stringify(call.arguments) });
      }
    } else {
      for (const result of message.results) {
        items.push({ type: "function_call_output", call_id: result.toolCallId, output: result.output });
      }
    }
  }
  return items;
}

/** Parse a non-streaming Responses payload (`data.output[]`). */
export function parseResponsesOutput(data: JsonRecord): { text: string; toolCalls: ToolCall[] } {
  const output = Array.isArray(data.output) ? data.output : [];
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    if (item.type === "function_call") {
      const id = typeof item.call_id === "string" ? item.call_id : typeof item.id === "string" ? item.id : "";
      const name = typeof item.name === "string" ? item.name : "";
      if (id && name) toolCalls.push({ id, name, arguments: parseArguments(item.arguments) });
    } else if (item.type === "message" && Array.isArray(item.content)) {
      for (const block of item.content) {
        if (isRecord(block) && block.type === "output_text" && typeof block.text === "string") textParts.push(block.text);
      }
    }
  }
  return { text: textParts.join("\n").trim(), toolCalls };
}

function eventType(message: ProviderEventStreamMessage): string | null {
  const type = message.data.type;
  return typeof type === "string" ? type : message.eventName;
}

function errorText(data: JsonRecord): string {
  const error = data.error;
  if (typeof error === "string") return error;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  if (typeof data.message === "string") return data.message;
  return "Provider stream failed.";
}

/**
 * Accumulate a Responses SSE stream (Codex/Copilot) into the final result. The
 * authoritative output arrives on the completion event's `response.output`; the
 * incremental events are accumulated only as a fallback.
 */
export async function accumulateResponsesStream(messages: AsyncIterable<ProviderEventStreamMessage>): Promise<AgentTurnResult> {
  const raw: string[] = [];
  const textParts: string[] = [];
  const calls = new Map<string, { id: string; name: string; args: string }>();
  for await (const message of messages) {
    raw.push(message.rawData);
    const type = eventType(message);
    if (!type) continue;
    if (type === "error" || type === "response.failed") throw new Error(errorText(message.data));
    if (type === "response.completed" || type === "response.done" || type === "response.incomplete") {
      const response = isRecord(message.data.response) ? message.data.response : null;
      if (response && Array.isArray(response.output)) {
        const parsed = parseResponsesOutput(response);
        return { text: parsed.text, toolCalls: parsed.toolCalls, rawResponseJson: JSON.stringify(raw) };
      }
      break;
    }
    if (type === "response.output_text.delta" && typeof message.data.delta === "string") {
      textParts.push(message.data.delta);
    } else if (type === "response.output_item.added" && isRecord(message.data.item) && message.data.item.type === "function_call") {
      const item = message.data.item;
      const key = typeof item.id === "string" ? item.id : typeof item.call_id === "string" ? item.call_id : "";
      const id = typeof item.call_id === "string" ? item.call_id : key;
      if (key) calls.set(key, { id, name: typeof item.name === "string" ? item.name : "", args: typeof item.arguments === "string" ? item.arguments : "" });
    } else if (type === "response.function_call_arguments.delta" && typeof message.data.item_id === "string" && typeof message.data.delta === "string") {
      const entry = calls.get(message.data.item_id);
      if (entry) entry.args += message.data.delta;
    } else if (type === "response.function_call_arguments.done" && typeof message.data.item_id === "string" && typeof message.data.arguments === "string") {
      const entry = calls.get(message.data.item_id);
      if (entry) entry.args = message.data.arguments;
    }
  }
  const toolCalls = [...calls.values()].filter((entry) => entry.name).map((entry) => ({ id: entry.id, name: entry.name, arguments: parseArguments(entry.args) }));
  return { text: textParts.join("").trim(), toolCalls, rawResponseJson: JSON.stringify(raw) };
}
