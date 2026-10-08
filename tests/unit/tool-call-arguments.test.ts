import { describe, expect, test } from "vitest";
import { parseChatChoice, accumulateChatStream } from "../../src/main/services/provider-tool-turns/chat-format";
import { parseResponsesOutput } from "../../src/main/services/provider-tool-turns/responses-format";
import { parseAnthropicContent } from "../../src/main/services/provider-tool-turns/anthropic-format";
import { parseBedrockOutput } from "../../src/main/services/provider-tool-turns/bedrock-format";
import { parseGeminiResponse } from "../../src/main/services/provider-tool-turns/gemini-format";
import type { JsonRecord, ProviderEventStreamMessage } from "../../src/main/services/provider-http";

async function* stream(items: JsonRecord[]): AsyncIterable<ProviderEventStreamMessage> {
  for (const data of items) yield { eventName: null, data, rawData: JSON.stringify(data) };
}

const chat = (args: unknown) => parseChatChoice({ choices: [{ message: { content: "", tool_calls: [{ id: "c1", function: { name: "write_file", arguments: args } }] }, finish_reason: "tool_calls" }] }).toolCalls[0];

describe("tool-call arguments", () => {
  test("half-written JSON is a named protocol error that keeps the parser's reason and the raw text", () => {
    expect(chat('{"path":"a.txt","content":"he')).toMatchObject({ arguments: {}, argumentsError: expect.stringMatching(/^not valid JSON \(.+\): \{"path":"a\.txt","content":"he$/) });
  });

  test("JSON that is not an object is an error naming what it was", () => {
    expect(chat("[1,2]").argumentsError).toBe("expected a JSON object, got an array");
    expect(chat('"a.txt"').argumentsError).toBe("expected a JSON object, got a string");
    expect(parseAnthropicContent({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t", name: "f", input: "x" }] }).toolCalls[0].argumentsError).toBe("expected a JSON object, got a string");
    expect(parseBedrockOutput({ stopReason: "tool_use", output: { message: { content: [{ toolUse: { toolUseId: "t", name: "f", input: [] } }] } } }).toolCalls[0].argumentsError).toBe("expected a JSON object, got an array");
    expect(parseGeminiResponse({ candidates: [{ content: { parts: [{ functionCall: { name: "f", args: 3 } }] }, finishReason: "STOP" }] }).toolCalls[0].argumentsError).toBe("expected a JSON object, got a number");
  });

  test("absent or empty arguments are a call with none; objects pass through", async () => {
    expect(chat("")).toEqual({ id: "c1", name: "write_file", arguments: {} });
    expect(chat('{"path":"a"}')).toEqual({ id: "c1", name: "write_file", arguments: { path: "a" } });
    expect(parseResponsesOutput({ status: "completed", output: [{ type: "function_call", call_id: "c2", name: "f", arguments: "{}" }] }).toolCalls[0]).toEqual({ id: "c2", name: "f", arguments: {} });
    const streamed = await accumulateChatStream(stream([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "c3", function: { name: "f", arguments: '{"a":' } }] }, finish_reason: "tool_calls" }] },
    ]));
    expect(streamed.toolCalls[0].argumentsError).toMatch(/^not valid JSON/);
    const typed = await accumulateChatStream(stream([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "c4", function: { name: "f", arguments: 42 } }, { index: 1, id: "c5", function: { name: "g", arguments: { a: 1 } } }] }, finish_reason: "tool_calls" }] },
    ]));
    const mixed = await accumulateChatStream(stream([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "c6", function: { name: "f", arguments: 42 } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: {} } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, id: "c7", function: { name: "g", arguments: '{"a":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: { a: 1 } } }] }, finish_reason: "tool_calls" }] },
    ]));
    expect(mixed.toolCalls.map((call) => call.argumentsError)).toEqual([
      "expected one JSON object, got 2 non-text fragments", "expected one JSON object, got text and 1 non-text fragment",
    ]);
    expect(typed.toolCalls).toEqual([{ id: "c4", name: "f", arguments: {}, argumentsError: "expected a JSON object, got a number" }, { id: "c5", name: "g", arguments: { a: 1 } }]);
  });
});
