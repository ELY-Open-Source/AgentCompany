import { afterEach, describe, expect, test, vi } from "vitest";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { makeChatCompletionsTurn } from "../../src/main/services/provider-tool-turns/turns";

const bodies: Array<Record<string, unknown>> = [];

function sseResponse(): Response {
  const text = "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  bodies.length = 0;
});

describe("stream usage requests", () => {
  test("xAI and Groq streams ask for token usage; Mistral and Cerebras streams do not", async () => {
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return sseResponse();
    });
    for (const key of ["xai", "groq", "mistral", "cerebras"] as const) {
      const result = await providerAdapters[key].streamResponse({ authProfile: { type: "api_key", apiKey: "k" }, model: "m", prompt: "p", instructions: null });
      for await (const event of result.events) void event;
    }
    expect(bodies.map((body) => body.stream_options ?? null)).toEqual([{ include_usage: true }, { include_usage: true }, null, null]);

    await makeChatCompletionsTurn("https://api.x.ai/v1/chat/completions", "xAI", true)({ credential: { apiKey: "k" }, model: "m", instructions: null, messages: [{ role: "user", text: "hi" }], tools: [] });
    expect(bodies.at(-1)?.stream_options).toEqual({ include_usage: true });
  });
});
