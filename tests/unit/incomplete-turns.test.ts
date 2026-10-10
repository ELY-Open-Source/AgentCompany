import { afterEach, describe, expect, test, vi } from "vitest";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import type { JsonRecord, ProviderEventStreamMessage } from "../../src/main/services/provider-http";
import { accumulateResponsesStream, parseResponsesOutput } from "../../src/main/services/provider-tool-turns/responses-format";
import { accumulateChatStream, parseChatChoice } from "../../src/main/services/provider-tool-turns/chat-format";
import { parseAnthropicContent } from "../../src/main/services/provider-tool-turns/anthropic-format";
import { parseBedrockOutput } from "../../src/main/services/provider-tool-turns/bedrock-format";
import { parseGeminiResponse } from "../../src/main/services/provider-tool-turns/gemini-format";
import { mapAnthropicMessageStream, mapOpenAiChatCompletionStream, mapOpenAiResponseStream } from "../../src/main/services/provider-streaming";

async function* stream(items: JsonRecord[]): AsyncIterable<ProviderEventStreamMessage> {
  for (const data of items) yield { eventName: null, data, rawData: JSON.stringify(data) };
}

async function types(events: AsyncIterable<{ type: string; textDelta: string | null }>): Promise<string[]> {
  const seen: string[] = [];
  for await (const event of events) seen.push(event.type === "error" ? `error:${event.textDelta}` : event.type);
  return seen;
}

const call = (id: string) => ({ type: "function_call", call_id: id, name: "write_file", arguments: '{"path":"a' });

describe("a turn the provider cut short is never treated as finished", () => {
  test("Responses: incomplete status, incomplete event, and a stream with no completion all fail", async () => {
    expect(() => parseResponsesOutput({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [call("c1")] })).toThrow("max_output_tokens");
    await expect(accumulateResponsesStream(stream([
      { type: "response.output_item.done", item: call("c1") },
      { type: "response.incomplete", response: { status: "incomplete", incomplete_details: { reason: "content_filter" }, output: [] } },
    ]))).rejects.toThrow("content_filter");
    await expect(accumulateResponsesStream(stream([{ type: "response.output_item.done", item: call("c1") }]))).rejects.toThrow("no stop reason");
    expect(parseResponsesOutput({ status: "completed", output: [] }).toolCalls).toEqual([]);
  });

  test("Chat: length and content_filter fail, a stream without finish_reason fails, stop and tool_calls pass", async () => {
    expect(() => parseChatChoice({ choices: [{ message: { content: "half" }, finish_reason: "length" }] })).toThrow("length");
    await expect(accumulateChatStream(stream([{ choices: [{ delta: { content: "half" } }] }]))).rejects.toThrow("no stop reason");
    await expect(accumulateChatStream(stream([{ choices: [{ delta: { content: "x" }, finish_reason: "content_filter" }] }]))).rejects.toThrow("content_filter");
    expect((await accumulateChatStream(stream([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]))).text).toBe("ok");
    expect(parseChatChoice({ choices: [{ message: { content: "ok" }, finish_reason: "tool_calls" }] }).text).toBe("ok");
  });

  test("Anthropic and Bedrock: max_tokens fails; end_turn and tool_use pass", () => {
    expect(() => parseAnthropicContent({ stop_reason: "max_tokens", content: [{ type: "tool_use", id: "t", name: "f", input: {} }] })).toThrow("max_tokens");
    expect(parseAnthropicContent({ stop_reason: "tool_use", content: [] }).toolCalls).toEqual([]);
    expect(() => parseBedrockOutput({ stopReason: "max_tokens", output: { message: { content: [] } } })).toThrow("max_tokens");
    expect(parseBedrockOutput({ stopReason: "end_turn", output: { message: { content: [{ text: "ok" }] } } }).text).toBe("ok");
  });

  test("Gemini: MAX_TOKENS fails, STOP passes", () => {
    const parts = [{ text: "ok" }];
    expect(() => parseGeminiResponse({ candidates: [{ content: { parts }, finishReason: "MAX_TOKENS" }] })).toThrow("MAX_TOKENS");
    expect(parseGeminiResponse({ candidates: [{ content: { parts }, finishReason: "STOP" }] }).text).toBe("ok");
  });

  test("streamed replies: a cut-off stop is an error, not a message_stop", async () => {
    expect(await types(mapOpenAiResponseStream(stream([{ type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } }]))))
      .toEqual([expect.stringMatching(/^error:.*max_output_tokens/)]);
    expect(await types(mapOpenAiChatCompletionStream(stream([{ choices: [{ delta: { content: "half" }, finish_reason: "length" }] }]))))
      .toEqual(["message_start", "text_delta", expect.stringMatching(/^error:.*length/)]);
    expect(await types(mapAnthropicMessageStream(stream([{ type: "message_start" }, { type: "message_delta", delta: { stop_reason: "max_tokens" } }, { type: "message_stop" }]))))
      .toEqual(["message_start", expect.stringMatching(/^error:.*max_tokens/)]);
  });
});

describe("one-shot responses cut short fail instead of saving partial text", () => {
  const reply = (body: unknown) => vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  const input = { authProfile: { type: "api_key" as const, apiKey: "k" }, model: "m", prompt: "p", instructions: null };
  afterEach(() => vi.unstubAllGlobals());

  test("OpenAI incomplete, Anthropic max_tokens and chat length all reject; finished replies return their text", async () => {
    reply({ id: "r", status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: "half" });
    await expect(providerAdapters.openai.createResponse!(input)).rejects.toThrow("max_output_tokens");
    reply({ stop_reason: "max_tokens", content: [{ type: "text", text: "half" }] });
    await expect(providerAdapters.anthropic.createResponse!(input)).rejects.toThrow("max_tokens");
    reply({ choices: [{ message: { content: "half" }, finish_reason: "length" }] });
    await expect(providerAdapters.groq.createResponse!(input)).rejects.toThrow("length");
    reply({ choices: [{ message: { content: "whole" }, finish_reason: "stop" }] });
    expect((await providerAdapters.groq.createResponse!(input)).text).toBe("whole");
    reply({ stop_reason: "end_turn", content: [{ type: "text", text: "whole" }] });
    expect((await providerAdapters.anthropic.createResponse!(input)).text).toBe("whole");
  });
});
