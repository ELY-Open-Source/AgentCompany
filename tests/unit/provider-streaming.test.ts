import { describe, expect, test } from "vitest";
import { readServerSentEvents, type ProviderEventStreamMessage } from "../../src/main/services/provider-http";
import {
  cancelUnsupported,
  mapAnthropicMessageStream,
  mapOpenAiChatCompletionStream,
  mapOpenAiResponseStream,
  streamUnsupported,
} from "../../src/main/services/provider-streaming";

describe("provider streaming", () => {
  test("parses server sent events and skips done sentinels", async () => {
    const source = [
      "event: response.output_text.delta",
      "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Hel\"}",
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    const messages = await collect(readServerSentEvents(streamFromText(source, 19)));

    expect(messages).toEqual([{
      eventName: "response.output_text.delta",
      data: { type: "response.output_text.delta", delta: "Hel" },
      rawData: "{\"type\":\"response.output_text.delta\",\"delta\":\"Hel\"}",
    }]);
  });

  test("maps OpenAI Responses stream deltas", async () => {
    const events = await collect(mapOpenAiResponseStream(asyncMessages([
      message("response.created", { type: "response.created" }),
      message("response.output_text.delta", { type: "response.output_text.delta", delta: "Hel" }),
      message("response.output_text.delta", { type: "response.output_text.delta", delta: "lo" }),
      message("response.completed", { type: "response.completed" }),
    ])));

    expect(events.map((event) => [event.type, event.textDelta])).toEqual([
      ["message_start", null],
      ["text_delta", "Hel"],
      ["text_delta", "lo"],
      ["message_stop", null],
    ]);
  });

  test("maps OpenAI-compatible chat completion deltas", async () => {
    const events = await collect(mapOpenAiChatCompletionStream(asyncMessages([
      message(null, { choices: [{ delta: { content: "Hel" } }] }),
      message(null, { choices: [{ delta: { content: "lo" } }] }),
      message(null, { choices: [{ delta: {}, finish_reason: "stop" }] }),
    ])));

    expect(events.map((event) => [event.type, event.textDelta])).toEqual([
      ["message_start", null],
      ["text_delta", "Hel"],
      ["text_delta", "lo"],
      ["message_stop", null],
    ]);
  });

  test("maps Anthropic message stream deltas", async () => {
    const events = await collect(mapAnthropicMessageStream(asyncMessages([
      message("message_start", { type: "message_start" }),
      message("content_block_delta", { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } }),
      message("content_block_delta", { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } }),
      message("message_stop", { type: "message_stop" }),
    ])));

    expect(events.map((event) => [event.type, event.textDelta])).toEqual([
      ["message_start", null],
      ["text_delta", "Hel"],
      ["text_delta", "lo"],
      ["message_stop", null],
    ]);
  });

  test("fails unsupported stream and cancel contracts early", async () => {
    await expect(streamUnsupported("Provider")()).rejects.toThrow("Provider streaming is unavailable.");
    await expect(cancelUnsupported("Provider")()).rejects.toThrow("Provider response cancellation is unavailable.");
  });
});

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const item of items) collected.push(item);
  return collected;
}

async function* asyncMessages(messages: ProviderEventStreamMessage[]): AsyncIterable<ProviderEventStreamMessage> {
  for (const item of messages) yield item;
}

function message(eventName: string | null, data: Record<string, unknown>): ProviderEventStreamMessage {
  return { eventName, data, rawData: JSON.stringify(data) };
}

function streamFromText(source: string, splitAt: number): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(source.slice(0, splitAt)));
      controller.enqueue(encoder.encode(source.slice(splitAt)));
      controller.close();
    },
  });
}
