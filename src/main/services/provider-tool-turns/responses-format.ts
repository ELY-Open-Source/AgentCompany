/**
 * OpenAI Responses API encoding/decoding, shared by the openai, gpt-account
 * (Codex) and github-copilot turns. Matches Pi's `convertResponsesMessages` /
 * `convertResponsesTools` and the Responses streaming event shapes.
 */
import { isRecord, ProviderHttpError, readProviderErrorCode, type JsonRecord, type ProviderEventStreamMessage } from "../provider-http";
import { incompleteTurn, replayIn, toolCallFromJson, type AgentTurnMessage, type AgentTurnResult, type AssistantReplay, type ToolCall, type ToolDefinition } from "../provider-tool-turn";

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
      const replay = replayIn(message, "responses");
      if (replay) {
        items.push(...(replay.content as unknown[]));
        continue;
      }
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
export function parseResponsesOutput(data: JsonRecord): { text: string; toolCalls: ToolCall[]; replay: AssistantReplay } {
  if (data.status !== "completed") throw incompleteTurn(incompleteReason(data));
  const output = Array.isArray(data.output) ? data.output : [];
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    if (item.type === "function_call") {
      const id = typeof item.call_id === "string" ? item.call_id : typeof item.id === "string" ? item.id : "";
      const name = typeof item.name === "string" ? item.name : "";
      if (id && name) toolCalls.push(toolCallFromJson(id, name, item.arguments));
    } else if (item.type === "message" && Array.isArray(item.content)) {
      for (const block of item.content) {
        if (isRecord(block) && block.type === "output_text" && typeof block.text === "string") textParts.push(block.text);
      }
    }
  }
  return { text: textParts.join("\n").trim(), toolCalls, replay: { format: "responses", content: responsesReplay(output) } };
}

/** Output items as next-turn input, the Codex way under store:false: no item ids, and reasoning only when it carries its encrypted content. */
function responsesReplay(output: unknown[]): unknown[] {
  return output.filter(isRecord)
    .filter((item) => item.type !== "reasoning" || typeof item.encrypted_content === "string")
    .map(({ id: _id, ...item }) => item);
}

/** Why a Responses payload is not complete: its incomplete_details reason, else its status. */
export function incompleteReason(response: JsonRecord): unknown {
  return isRecord(response.incomplete_details) && typeof response.incomplete_details.reason === "string" ? response.incomplete_details.reason : response.status;
}

function eventType(message: ProviderEventStreamMessage): string | null {
  const type = message.data.type;
  return typeof type === "string" ? type : message.eventName;
}

/** The error of an `error` event, or of a `response.failed` event's response. */
function streamError(data: JsonRecord): unknown {
  return data.error ?? (isRecord(data.response) ? data.response.error : undefined);
}

function errorText(data: JsonRecord): string {
  const error = streamError(data);
  if (typeof error === "string") return error;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  if (typeof data.message === "string") return data.message;
  return "Provider stream failed.";
}

/** The error's code: the error object's code or type, or the event's own code. */
function errorCode(data: JsonRecord): string | null {
  const error = streamError(data);
  return isRecord(error) ? readProviderErrorCode({ error }) : typeof data.code === "string" ? data.code : null;
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
    if (type === "error" || type === "response.failed") throw new ProviderHttpError(errorText(message.data), null, null, false, errorCode(message.data));
    if (type === "response.output_item.done" && isRecord(message.data.item)) {
      streamed.push(message.data.item);
    }
    if (type === "response.completed" || type === "response.done" || type === "response.incomplete") {
      const response = isRecord(message.data.response) ? message.data.response : {};
      // Codex completions may omit the status; the event type says it finished unless a status says otherwise.
      if (type === "response.incomplete" || (response.status !== undefined && response.status !== "completed")) throw incompleteTurn(incompleteReason(response) ?? "incomplete");
      const completionOutput = Array.isArray(response.output) ? response.output : [];
      const output = completionOutput.length > 0 ? completionOutput : streamed;
      return { ...parseResponsesOutput({ status: "completed", output }), rawResponseJson: JSON.stringify(raw) };
    }
  }
  throw incompleteTurn(null);
}
