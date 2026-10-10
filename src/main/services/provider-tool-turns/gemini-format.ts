/** Gemini generateContent encoding for Vertex AI. */
import { OUTPUT_RESERVE_TOKENS } from "../context-budget";
import { isRecord, type JsonRecord } from "../provider-http";
import { FINISHED_STOP_REASONS, replayIn, requireFinished, toolCallFromObject, type AgentTurnMessage, type AssistantReplay, type ToolCall, type ToolDefinition } from "../provider-tool-turn";

function geminiToolDefs(tools: ToolDefinition[]): unknown[] {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parametersJsonSchema: tool.parameters,
      })),
    },
  ];
}

function toGeminiContents(messages: AgentTurnMessage[]): JsonRecord[] {
  const contents: JsonRecord[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      contents.push({ role: "user", parts: [{ text: message.text }] });
    } else if (message.role === "assistant") {
      const replay = replayIn(message, "gemini");
      if (replay) {
        contents.push({ role: "model", parts: replay.content });
        continue;
      }
      const parts: unknown[] = [];
      if (message.text) parts.push({ text: message.text });
      for (const call of message.toolCalls) {
        parts.push({ functionCall: { name: call.name, args: call.arguments } });
      }
      if (parts.length > 0) contents.push({ role: "model", parts });
    } else {
      const responses: unknown[] = message.results.map((result) => ({
        functionResponse: { name: result.toolName, response: { output: result.output } },
      }));
      if (message.followUp) responses.push({ text: message.followUp });
      const last = contents[contents.length - 1];
      if (last && last.role === "user" && Array.isArray(last.parts) && last.parts.some((part) => isRecord(part) && "functionResponse" in part)) {
        (last.parts as unknown[]).push(...responses);
      } else {
        contents.push({ role: "user", parts: responses });
      }
    }
  }
  return contents;
}

/** The Vertex AI generateContent body. */
export function vertexRequestBody(input: {
  instructions: string | null;
  messages: AgentTurnMessage[];
  tools: ToolDefinition[];
}): JsonRecord {
  const body: JsonRecord = { contents: toGeminiContents(input.messages), generationConfig: { maxOutputTokens: OUTPUT_RESERVE_TOKENS } };
  if (input.instructions) body.systemInstruction = { parts: [{ text: input.instructions }] };
  if (input.tools.length > 0) {
    body.tools = geminiToolDefs(input.tools);
    body.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
  }
  return body;
}

function partsToResult(parts: unknown[]): { text: string[]; toolCalls: ToolCall[] } {
  const text: string[] = [];
  const toolCalls: ToolCall[] = [];
  let counter = 0;
  for (const part of parts) {
    if (!isRecord(part)) continue;
    if (typeof part.text === "string" && part.thought !== true) text.push(part.text);
    else if (isRecord(part.functionCall)) {
      const fc = part.functionCall;
      const name = typeof fc.name === "string" ? fc.name : "";
      if (!name) continue;
      const id = typeof fc.id === "string" && fc.id ? fc.id : `${name}_${(counter += 1)}`;
      toolCalls.push(toolCallFromObject(id, name, fc.args));
    }
  }
  return { text, toolCalls };
}

/** Parse a non-streaming Gemini generateContent response (Vertex). */
export function parseGeminiResponse(data: JsonRecord): { text: string; toolCalls: ToolCall[]; replay: AssistantReplay } {
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  requireFinished(isRecord(candidates[0]) ? candidates[0].finishReason : null, FINISHED_STOP_REASONS.gemini);
  const content = candidates.length > 0 && isRecord(candidates[0]) && isRecord(candidates[0].content) ? candidates[0].content : null;
  const parts = content && Array.isArray(content.parts) ? content.parts : [];
  const result = partsToResult(parts);
  return { text: result.text.join("").trim(), toolCalls: result.toolCalls, replay: { format: "gemini", content: parts } };
}
