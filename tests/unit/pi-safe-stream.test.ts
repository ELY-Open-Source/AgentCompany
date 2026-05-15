import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type Model,
} from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import { createSafePiStream } from "../../src/main/worker/runtime/pi-safe-stream";
import { InMemoryCredentialConcurrencyGate } from "../../src/main/worker/runtime/credential-concurrency-gate";

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

  it("serializes calls that share a gated credential", async () => {
    const gate = new InMemoryCredentialConcurrencyGate(() => 1);
    let activeCalls = 0;
    let peakActive = 0;

    const safeStream = createSafePiStream((_model, _context) => {
      activeCalls += 1;
      peakActive = Math.max(peakActive, activeCalls);
      const stream = createAssistantMessageEventStream();
      setTimeout(() => {
        const message = createAssistantMessage();
        stream.push({ type: "done", reason: "stop", message });
        stream.end(message);
        activeCalls -= 1;
      }, 5);
      return stream;
    }, gate);

    const drain = async (stream: ReturnType<typeof safeStream>) => {
      for await (const _event of stream) {
        // drain
      }
      await stream.result();
    };

    const model = createModel();
    const a = safeStream(model, emptyContext, { apiKey: "shared" });
    const b = safeStream(model, emptyContext, { apiKey: "shared" });
    const c = safeStream(model, emptyContext, { apiKey: "shared" });

    await Promise.all([drain(a), drain(b), drain(c)]);
    expect(peakActive).toBe(1);
  });

  it("does not gate calls without an apiKey", async () => {
    const gate = new InMemoryCredentialConcurrencyGate(() => 1);
    let activeCalls = 0;
    let peakActive = 0;

    const safeStream = createSafePiStream((_model, _context) => {
      activeCalls += 1;
      peakActive = Math.max(peakActive, activeCalls);
      const stream = createAssistantMessageEventStream();
      setTimeout(() => {
        const message = createAssistantMessage();
        stream.push({ type: "done", reason: "stop", message });
        stream.end(message);
        activeCalls -= 1;
      }, 5);
      return stream;
    }, gate);

    const drain = async (stream: ReturnType<typeof safeStream>) => {
      for await (const _event of stream) {
        // drain
      }
      await stream.result();
    };

    const model = createModel();
    await Promise.all([
      drain(safeStream(model, emptyContext)),
      drain(safeStream(model, emptyContext)),
    ]);
    expect(peakActive).toBe(2);
  });

  it("releases the slot when the upstream stream throws", async () => {
    const gate = new InMemoryCredentialConcurrencyGate(() => 1);
    let attempt = 0;

    const safeStream = createSafePiStream(() => {
      attempt += 1;
      if (attempt === 1) throw new Error("first call boom");
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const message = createAssistantMessage();
        stream.push({ type: "done", reason: "stop", message });
        stream.end(message);
      });
      return stream;
    }, gate);

    const failing = safeStream(createModel(), emptyContext, { apiKey: "shared" });
    for await (const _event of failing) {
      // drain
    }
    await failing.result();

    const succeeding = safeStream(createModel(), emptyContext, { apiKey: "shared" });
    for await (const _event of succeeding) {
      // drain
    }
    await expect(succeeding.result()).resolves.toMatchObject({ stopReason: "stop" });
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
