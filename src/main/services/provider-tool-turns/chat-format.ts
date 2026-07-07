/** OpenAI Chat Completions encoding/decoding (xAI, Groq, Mistral, Cerebras, OpenRouter). */
import { isRecord, type JsonRecord } from "../provider-http";
import { parseArguments, type AgentTurnMessage, type ToolCall, type ToolDefinition } from "../provider-tool-turn";

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
