import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type Model,
} from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import { createSafePiStream } from "../../src/main/worker/runtime/pi-safe-stream";

function createModel(): Model<"openai-responses"> {
  return {
    id: "mock",
    name: "mock",
    api: "openai-responses",
    provider: "openai",
    baseUrl: "https://example.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 2048,
  };
}

function createAssistantMessage(): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "done" }],
    api: "openai-responses",
    provider: "openai",
    model: "mock",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

const emptyContext: Context = { messages: [] };

describe("pi safe stream", () => {
  it("forwards successful stream events", async () => {
    const safeStream = createSafePiStream(() => {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const message = createAssistantMessage();
        stream.push({ type: "done", reason: "stop", message });
        stream.end(message);
      });
      return stream;
    });

    const stream = safeStream(createModel(), emptyContext);
    const events: AssistantMessageEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual(["done"]);
    await expect(stream.result()).resolves.toMatchObject({ stopReason: "stop" });
  });

  it("turns rejected stream setup into an error event", async () => {
    const safeStream = createSafePiStream(async () => {
      throw new Error("stream setup failed");
    });

    const stream = safeStream(createModel(), emptyContext);
    const events: AssistantMessageEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }
    const result = await stream.result();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "error",
      reason: "error",
      error: {
        stopReason: "error",
        errorMessage: "stream setup failed",
      },
    });
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("stream setup failed");
  });
});
