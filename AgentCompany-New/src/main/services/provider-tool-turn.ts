/**
 * Provider-agnostic single turn of a tool-use ("function calling") conversation.
 *
 * The agent loop maintains a normalized conversation ({@link AgentTurnMessage}[])
 * and the requested {@link ToolDefinition}s; these helpers translate that into the
 * provider's wire format (OpenAI Responses API or Anthropic Messages API), call
 * the live endpoint, and parse the assistant's reply plus any tool calls back into
 * the normalized shape.
 */
import { isRecord, postJson, type JsonRecord } from "./provider-http";

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  parameters: JsonRecord;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: JsonRecord;
}

export type AgentTurnMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls: ToolCall[] }
  | { role: "tool"; results: Array<{ toolCallId: string; toolName: string; output: string }> };

export interface AgentTurnResult {
  text: string;
  toolCalls: ToolCall[];
  rawResponseJson: string;
}

export interface ProviderToolTurnInput {
  apiKey: string;
  model: string;
  instructions: string | null;
  messages: AgentTurnMessage[];
  tools: ToolDefinition[];
}

function parseArguments(value: unknown): JsonRecord {
  if (isRecord(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (isRecord(parsed)) return parsed;
    } catch {
      return {};
    }
  }
  return {};
}

// ---- OpenAI Responses API ----

function toOpenAiInput(messages: AgentTurnMessage[]): unknown[] {
  const items: unknown[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      items.push({ role: "user", content: message.text });
    } else if (message.role === "assistant") {
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

function parseOpenAiResult(data: JsonRecord): AgentTurnResult {
  const output = Array.isArray(data.output) ? data.output : [];
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    if (item.type === "function_call") {
      const callId = typeof item.call_id === "string" ? item.call_id : typeof item.id === "string" ? item.id : "";
      const name = typeof item.name === "string" ? item.name : "";
      if (callId && name) toolCalls.push({ id: callId, name, arguments: parseArguments(item.arguments) });
    } else if (item.type === "message" && Array.isArray(item.content)) {
      for (const block of item.content) {
        if (isRecord(block) && block.type === "output_text" && typeof block.text === "string") textParts.push(block.text);
      }
    }
  }
  return { text: textParts.join("\n").trim(), toolCalls, rawResponseJson: JSON.stringify(data) };
}

export async function runOpenAiToolTurn(input: ProviderToolTurnInput): Promise<AgentTurnResult> {
  const body: JsonRecord = {
    model: input.model,
    input: toOpenAiInput(input.messages),
    tools: input.tools.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters })),
    tool_choice: "auto",
    ...(input.instructions ? { instructions: input.instructions } : {}),
  };
  const response = await postJson("https://api.openai.com/v1/responses", { authorization: `Bearer ${input.apiKey}` }, body);
  return parseOpenAiResult(response.data);
}

// ---- Anthropic Messages API ----

function toAnthropicMessages(messages: AgentTurnMessage[]): unknown[] {
  const out: unknown[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: [{ type: "text", text: message.text }] });
    } else if (message.role === "assistant") {
      const content: unknown[] = [];
      if (message.text) content.push({ type: "text", text: message.text });
      for (const call of message.toolCalls) content.push({ type: "tool_use", id: call.id, name: call.name, input: call.arguments });
      out.push({ role: "assistant", content });
    } else {
      out.push({ role: "user", content: message.results.map((result) => ({ type: "tool_result", tool_use_id: result.toolCallId, content: result.output })) });
    }
  }
  return out;
}

function parseAnthropicResult(data: JsonRecord): AgentTurnResult {
  const content = Array.isArray(data.content) ? data.content : [];
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string") textParts.push(block.text);
    else if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
      toolCalls.push({ id: block.id, name: block.name, arguments: isRecord(block.input) ? block.input : {} });
    }
  }
  return { text: textParts.join("\n").trim(), toolCalls, rawResponseJson: JSON.stringify(data) };
}

export async function runAnthropicToolTurn(input: ProviderToolTurnInput): Promise<AgentTurnResult> {
  const body: JsonRecord = {
    model: input.model,
    max_tokens: 4096,
    tools: input.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })),
    messages: toAnthropicMessages(input.messages),
    ...(input.instructions ? { system: input.instructions } : {}),
  };
  const response = await postJson("https://api.anthropic.com/v1/messages", { "x-api-key": input.apiKey, "anthropic-version": "2023-06-01" }, body);
  return parseAnthropicResult(response.data);
}

export type ToolTurnFn = (input: ProviderToolTurnInput) => Promise<AgentTurnResult>;

/** Provider keys that can drive a native tool-use loop, by wire protocol. */
export function selectToolTurn(providerKey: string): ToolTurnFn {
  if (providerKey === "openai") return runOpenAiToolTurn;
  if (providerKey === "anthropic") return runAnthropicToolTurn;
  throw new Error(`${providerKey} does not support agent tool execution; assign the agent an OpenAI or Anthropic provider.`);
}

export function supportsToolTurn(providerKey: string): boolean {
  return providerKey === "openai" || providerKey === "anthropic";
}
