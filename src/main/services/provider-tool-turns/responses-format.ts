/**
 * OpenAI Responses API encoding/decoding, shared by the openai, gpt-account
 * (Codex) and github-copilot turns. Matches Pi's `convertResponsesMessages` /
 * `convertResponsesTools` and the Responses streaming event shapes.
 */
import { isRecord, type JsonRecord, type ProviderEventStreamMessage } from "../provider-http";
import { parseArguments, type AgentTurnMessage, type AgentTurnResult, type ToolCall, type ToolDefinition } from "../provider-tool-turn";

export function responsesToolDefs(tools: ToolDefinition[], strict: boolean | null = false): unknown[] {
  // `strict` must be a boolean or omitted. Passing `strict: null` (the Codex
  // path) is malformed and makes the endpoint drop the whole tool list, so the
  // model has nothing to call. Omit the field instead of sending null.
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    ...(strict === null ? {} : { strict }),
  }));
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
      if (message.followUp) items.push({ role: "user", content: [{ type: "input_text", text: message.followUp }] });
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
 * Accumulate a Responses SSE stream (Codex/Copilot) into the final result.
 *
 * The ChatGPT/Codex backend streams each output item in a
 * `response.output_item.done` event and then sends a `response.completed`
 * whose `response.output` is EMPTY. Reading only the completion event there
 * loses every tool call (the model acted, but the turn parses as empty). So
 * collect items as they finish and fall back to them when the completion
 * carries no output of its own.
 */
export async function accumulateResponsesStream(messages: AsyncIterable<ProviderEventStreamMessage>): Promise<AgentTurnResult> {
  const raw: string[] = [];
  const streamed: unknown[] = [];
  for await (const message of messages) {
    raw.push(message.rawData);
    const type = eventType(message);
    if (!type) continue;
    if (type === "error" || type === "response.failed") throw new Error(errorText(message.data));
    if (type === "response.output_item.done" && isRecord(message.data.item)) {
      streamed.push(message.data.item);
    }
    if (type === "response.completed" || type === "response.done" || type === "response.incomplete") {
      const response = isRecord(message.data.response) ? message.data.response : null;
      const completionOutput = response && Array.isArray(response.output) ? response.output : [];
      const output = completionOutput.length > 0 ? completionOutput : streamed;
      const parsed = parseResponsesOutput({ output });
      return { text: parsed.text, toolCalls: parsed.toolCalls, rawResponseJson: JSON.stringify(raw) };
    }
  }
  if (streamed.length > 0) {
    const parsed = parseResponsesOutput({ output: streamed });
    return { text: parsed.text, toolCalls: parsed.toolCalls, rawResponseJson: JSON.stringify(raw) };
  }
  throw new Error("Responses stream ended before a completion event.");
}
