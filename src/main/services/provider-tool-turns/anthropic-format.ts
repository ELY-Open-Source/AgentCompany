/** Anthropic Messages API encoding/decoding, shared by anthropic + claude-pro. */
import { isRecord, type JsonRecord } from "../provider-http";
import { type AgentTurnMessage, type ToolCall, type ToolDefinition } from "../provider-tool-turn";

export function anthropicToolDefs(tools: ToolDefinition[]): unknown[] {
  return tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters }));
}

export function toAnthropicMessages(messages: AgentTurnMessage[]): unknown[] {
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

export function parseAnthropicContent(data: JsonRecord): { text: string; toolCalls: ToolCall[] } {
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
  return { text: textParts.join("\n").trim(), toolCalls };
}
