import { describe, expect, test } from "vitest";
import type { JsonRecord, ProviderEventStreamMessage } from "../../src/main/services/provider-http";
import type { AgentTurnMessage, AgentTurnResult } from "../../src/main/services/provider-tool-turn";
import { accumulateResponsesStream, parseResponsesOutput, toResponsesInput } from "../../src/main/services/provider-tool-turns/responses-format";
import { accumulateChatStream, parseChatChoice, toChatMessages } from "../../src/main/services/provider-tool-turns/chat-format";
import { parseAnthropicContent, toAnthropicMessages } from "../../src/main/services/provider-tool-turns/anthropic-format";
import { parseBedrockOutput, toBedrockMessages } from "../../src/main/services/provider-tool-turns/bedrock-format";
import { parseGeminiResponse, vertexRequestBody } from "../../src/main/services/provider-tool-turns/gemini-format";

async function* stream(items: JsonRecord[]): AsyncIterable<ProviderEventStreamMessage> {
  for (const data of items) yield { eventName: null, data, rawData: JSON.stringify(data) };
}

/** The conversation the run loop builds after a turn that called one tool. */
function after(turn: Pick<AgentTurnResult, "text" | "toolCalls" | "replay">): AgentTurnMessage[] {
  return [
    { role: "user", text: "go" },
    { role: "assistant", text: turn.text, toolCalls: turn.toolCalls, ...(turn.replay ? { replay: turn.replay } : {}) },
    { role: "tool", results: turn.toolCalls.map((call) => ({ toolCallId: call.id, toolName: call.name, output: "ok" })) },
  ];
}

describe("reasoning survives tool turns", () => {
  test("Responses: encrypted reasoning goes back before the call, without item ids; unencrypted reasoning cannot be replayed under store:false", async () => {
    const turn = await accumulateResponsesStream(stream([
      { type: "response.output_item.done", item: { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "ENC" } },
      { type: "response.output_item.done", item: { type: "function_call", id: "fc_1", call_id: "c1", name: "f", arguments: "{}" } },
      { type: "response.completed", response: { output: [] } },
    ]));
    expect(toResponsesInput(after(turn)).slice(1, 3)).toEqual([
      { type: "reasoning", summary: [], encrypted_content: "ENC" },
      { type: "function_call", call_id: "c1", name: "f", arguments: "{}" },
    ]);
    const plain = parseResponsesOutput({ status: "completed", output: [{ type: "reasoning", id: "rs_2", summary: [] }, { type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text: "hi" }] }] });
    expect(plain.replay?.content).toEqual([{ type: "message", role: "assistant", content: [{ type: "output_text", text: "hi" }] }]);
  });

  test("Anthropic: thinking and redacted thinking blocks go back unmodified with their signatures", () => {
    const content = [
      { type: "thinking", thinking: "plan", signature: "SIG" },
      { type: "redacted_thinking", data: "OPAQUE" },
      { type: "tool_use", id: "t1", name: "f", input: { a: 1 } },
    ];
    const sent = toAnthropicMessages(after(parseAnthropicContent({ stop_reason: "tool_use", content }))) as JsonRecord[];
    expect(sent[1]).toEqual({ role: "assistant", content });
  });

  test("Bedrock: reasoningContent with its signature goes back unmodified", () => {
    const content = [{ reasoningContent: { reasoningText: { text: "plan", signature: "SIG" } } }, { toolUse: { toolUseId: "t1", name: "f", input: {} } }];
    const sent = toBedrockMessages(after(parseBedrockOutput({ stopReason: "tool_use", output: { message: { role: "assistant", content } } })));
    expect(sent[1]).toEqual({ role: "assistant", content });
  });

  test("Gemini: thought signatures on parts go back, streamed or not", async () => {
    const parts = [{ text: "plan", thought: true }, { functionCall: { name: "f", args: {} }, thoughtSignature: "SIG" }];
    const vertex = vertexRequestBody({ instructions: null, messages: after(parseGeminiResponse({ candidates: [{ content: { parts }, finishReason: "STOP" }] })), tools: [] });
    expect((vertex.contents as JsonRecord[])[1]).toEqual({ role: "model", parts });
  });

  test("Chat: streamed reasoning goes back under the field it came in, and OpenRouter details are merged into whole entries", async () => {
    const kimi = await accumulateChatStream(stream([
      { choices: [{ delta: { reasoning_content: "think " } }] },
      { choices: [{ delta: { reasoning_content: "hard" } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "f", arguments: "{}" } }] }, finish_reason: "tool_calls" }] },
    ]));
    expect((toChatMessages(null, after(kimi)) as JsonRecord[])[1]).toMatchObject({ role: "assistant", reasoning_content: "think hard" });
    const openrouter = await accumulateChatStream(stream([
      { choices: [{ delta: { reasoning: "a", reasoning_details: [{ type: "reasoning.text", text: "a", index: 0 }] } }] },
      { choices: [{ delta: { reasoning: "b", reasoning_details: [{ type: "reasoning.text", text: "b", signature: "SIG", index: 0 }] } }] },
      { choices: [{ delta: { reasoning_details: [{ type: "reasoning.encrypted", data: "ENC", index: 1 }] } }] },
      { choices: [{ delta: { content: "done" }, finish_reason: "stop" }] },
    ]));
    expect(openrouter.replay).toEqual({ format: "chat", content: { reasoning_details: [{ type: "reasoning.text", text: "ab", signature: "SIG", index: 0 }, { type: "reasoning.encrypted", data: "ENC", index: 1 }] } });
    const azure = parseChatChoice({ choices: [{ message: { content: "x", reasoning: "why" }, finish_reason: "stop" }] });
    expect(azure.replay).toEqual({ format: "chat", content: { reasoning: "why" } });
  });

  test("a turn from one wire format is never silently replayed in another", () => {
    const messages = after(parseAnthropicContent({ stop_reason: "end_turn", content: [{ type: "text", text: "hi" }] }));
    expect(() => toChatMessages(null, messages)).toThrow("anthropic format cannot be sent to a chat provider");
  });
});
