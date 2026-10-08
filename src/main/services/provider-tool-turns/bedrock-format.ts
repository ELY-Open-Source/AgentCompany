/** AWS Bedrock Converse API encoding/decoding (ported from Pi's bedrock handler). */
import { isRecord, type JsonRecord } from "../provider-http";
import { FINISHED_STOP_REASONS, replayIn, requireFinished, toolCallFromObject, type AgentTurnMessage, type AssistantReplay, type ToolCall, type ToolDefinition } from "../provider-tool-turn";

export function bedrockToolConfig(tools: ToolDefinition[]): JsonRecord {
  return {
    tools: tools.map((tool) => ({ toolSpec: { name: tool.name, description: tool.description, inputSchema: { json: tool.parameters } } })),
    toolChoice: { auto: {} },
  };
}

export function toBedrockMessages(messages: AgentTurnMessage[]): JsonRecord[] {
  const out: JsonRecord[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: [{ text: message.text }] });
    } else if (message.role === "assistant") {
      const replay = replayIn(message, "bedrock");
      const content: unknown[] = [];
      if (message.text) content.push({ text: message.text });
      for (const call of message.toolCalls) content.push({ toolUse: { toolUseId: call.id, name: call.name, input: call.arguments } });
      out.push({ role: "assistant", content: replay ? replay.content : content });
    } else {
      const content: unknown[] = message.results.map((result) => ({ toolResult: { toolUseId: result.toolCallId, content: [{ text: result.output }] } }));
      if (message.followUp) content.push({ text: message.followUp });
      out.push({ role: "user", content });
    }
  }
  return out;
}

export function parseBedrockOutput(data: JsonRecord): { text: string; toolCalls: ToolCall[]; replay: AssistantReplay } {
  requireFinished(data.stopReason, FINISHED_STOP_REASONS.bedrock);
  const output = isRecord(data.output) ? data.output : null;
  const message = output && isRecord(output.message) ? output.message : null;
  const content = message && Array.isArray(message.content) ? message.content : [];
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (typeof block.text === "string") textParts.push(block.text);
    else if (isRecord(block.toolUse)) {
      const toolUse = block.toolUse;
      const id = typeof toolUse.toolUseId === "string" ? toolUse.toolUseId : "";
      const name = typeof toolUse.name === "string" ? toolUse.name : "";
      if (id && name) toolCalls.push(toolCallFromObject(id, name, toolUse.input));
    }
  }
  return { text: textParts.join("\n").trim(), toolCalls, replay: { format: "bedrock", content } };
}
