/**
 * Google Cloud Code Assist (Gemini) encoding for the Antigravity backend.
 * Ported from Pi's google-shared `convertMessages` / `convertTools` and the
 * Antigravity request wrapper in google-gemini-cli.
 */
import { isRecord, type JsonRecord, type ProviderEventStreamMessage } from "../provider-http";
import { type AgentTurnMessage, type AgentTurnResult, type ToolCall, type ToolDefinition } from "../provider-tool-turn";

const ANTIGRAVITY_SYSTEM_INSTRUCTION =
  "You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding." +
  "You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question." +
  "**Absolute paths only**" +
  "**Proactiveness**";

function usesToolCallId(model: string): boolean {
  return model.startsWith("claude-") || model.startsWith("gpt-oss-");
}

function geminiToolDefs(model: string, tools: ToolDefinition[]): unknown[] {
  const useParameters = model.startsWith("claude-");
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        ...(useParameters ? { parameters: tool.parameters } : { parametersJsonSchema: tool.parameters }),
      })),
    },
  ];
}

function toGeminiContents(model: string, messages: AgentTurnMessage[]): JsonRecord[] {
  const withId = usesToolCallId(model);
  const contents: JsonRecord[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      contents.push({ role: "user", parts: [{ text: message.text }] });
    } else if (message.role === "assistant") {
      const parts: unknown[] = [];
      if (message.text) parts.push({ text: message.text });
      for (const call of message.toolCalls) {
        parts.push({ functionCall: { name: call.name, args: call.arguments, ...(withId ? { id: call.id } : {}) } });
      }
      if (parts.length > 0) contents.push({ role: "model", parts });
    } else {
      const responses: unknown[] = message.results.map((result) => ({
        functionResponse: { name: result.toolName, response: { output: result.output }, ...(withId ? { id: result.toolCallId } : {}) },
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

/** The full Antigravity request envelope ({project, model, request, ...}). */
export function antigravityRequestBody(input: {
  model: string;
  projectId: string;
  instructions: string | null;
  messages: AgentTurnMessage[];
  tools: ToolDefinition[];
  requestId: string;
}): JsonRecord {
  const request: JsonRecord = {
    contents: toGeminiContents(input.model, input.messages),
    systemInstruction: {
      role: "user",
      parts: [
        { text: ANTIGRAVITY_SYSTEM_INSTRUCTION },
        { text: `Please ignore following [ignore]${ANTIGRAVITY_SYSTEM_INSTRUCTION}[/ignore]` },
        ...(input.instructions ? [{ text: input.instructions }] : []),
      ],
    },
  };
  if (input.tools.length > 0) {
    request.tools = geminiToolDefs(input.model, input.tools);
    request.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
  }
  return { project: input.projectId, model: input.model, request, requestType: "agent", userAgent: "antigravity", requestId: input.requestId };
}

/** The Vertex AI generateContent body (Gemini, no Antigravity wrapper). */
export function vertexRequestBody(input: {
  model: string;
  instructions: string | null;
  messages: AgentTurnMessage[];
  tools: ToolDefinition[];
}): JsonRecord {
  const body: JsonRecord = { contents: toGeminiContents(input.model, input.messages) };
  if (input.instructions) body.systemInstruction = { parts: [{ text: input.instructions }] };
  if (input.tools.length > 0) {
    body.tools = geminiToolDefs(input.model, input.tools);
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
      toolCalls.push({ id, name, arguments: isRecord(fc.args) ? fc.args : {} });
    }
  }
  return { text, toolCalls };
}

/** Parse a non-streaming Gemini generateContent response (Vertex). */
export function parseGeminiResponse(data: JsonRecord): { text: string; toolCalls: ToolCall[] } {
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const content = candidates.length > 0 && isRecord(candidates[0]) && isRecord(candidates[0].content) ? candidates[0].content : null;
  const parts = content && Array.isArray(content.parts) ? content.parts : [];
  const result = partsToResult(parts);
  return { text: result.text.join("").trim(), toolCalls: result.toolCalls };
}

export async function accumulateGeminiStream(messages: AsyncIterable<ProviderEventStreamMessage>): Promise<AgentTurnResult> {
  const raw: string[] = [];
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];
  let counter = 0;
  for await (const message of messages) {
    raw.push(message.rawData);
    if (isRecord(message.data.error)) {
      const error = message.data.error;
      throw new Error(typeof error.message === "string" ? error.message : "Antigravity stream failed.");
    }
    const response = isRecord(message.data.response) ? message.data.response : null;
    if (!response) continue;
    const candidates = Array.isArray(response.candidates) ? response.candidates : [];
    const content = candidates.length > 0 && isRecord(candidates[0]) && isRecord(candidates[0].content) ? candidates[0].content : null;
    const parts = content && Array.isArray(content.parts) ? content.parts : [];
    for (const part of parts) {
      if (!isRecord(part)) continue;
      if (typeof part.text === "string" && part.thought !== true) {
        textParts.push(part.text);
      } else if (isRecord(part.functionCall)) {
        const fc = part.functionCall;
        const name = typeof fc.name === "string" ? fc.name : "";
        if (!name) continue;
        const id = typeof fc.id === "string" && fc.id ? fc.id : `${name}_${(counter += 1)}`;
        toolCalls.push({ id, name, arguments: isRecord(fc.args) ? fc.args : {} });
      }
    }
  }
  return { text: textParts.join("").trim(), toolCalls, rawResponseJson: JSON.stringify(raw) };
}
