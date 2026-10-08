import { describe, expect, test } from "vitest";
import { readTokenUsage, requestCostCents } from "../../src/main/services/spend";

describe("token usage and cost", () => {
  test("reads usage from every provider shape, cached and reasoning tokens included", () => {
    expect(readTokenUsage(JSON.stringify({ usage: { input_tokens: 1000, output_tokens: 200, input_tokens_details: { cached_tokens: 400 }, output_tokens_details: { reasoning_tokens: 50 } } })))
      .toEqual({ inputTokens: 1000, outputTokens: 200, cachedInputTokens: 400, reasoningTokens: 50 });
    expect(readTokenUsage(JSON.stringify({ usage: { input_tokens: 600, output_tokens: 80, cache_read_input_tokens: 300, cache_creation_input_tokens: 100 } })))
      .toEqual({ inputTokens: 1000, outputTokens: 80, cachedInputTokens: 300, reasoningTokens: 0 });
    expect(readTokenUsage(JSON.stringify({ usage: { inputTokens: 500, outputTokens: 70, cacheReadInputTokens: 100 } })))
      .toEqual({ inputTokens: 600, outputTokens: 70, cachedInputTokens: 100, reasoningTokens: 0 });
    expect(readTokenUsage(JSON.stringify({ usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 60, thoughtsTokenCount: 40, cachedContentTokenCount: 200 } })))
      .toEqual({ inputTokens: 900, outputTokens: 100, cachedInputTokens: 200, reasoningTokens: 40 });
    const chatStream = ["{\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}", "{\"choices\":[],\"usage\":{\"prompt_tokens\":120,\"completion_tokens\":30,\"prompt_tokens_details\":{\"cached_tokens\":20}}}", "[DONE]"];
    expect(readTokenUsage(JSON.stringify(chatStream))).toEqual({ inputTokens: 120, outputTokens: 30, cachedInputTokens: 20, reasoningTokens: 0 });
    const responsesStream = ["{\"type\":\"response.created\"}", "{\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":10,\"output_tokens\":5}}}"];
    expect(readTokenUsage(JSON.stringify(responsesStream))).toEqual({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 0, reasoningTokens: 0 });
    const moonshotStream = ["{\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\",\"usage\":{\"prompt_tokens\":40,\"completion_tokens\":9}}]}"];
    expect(readTokenUsage(JSON.stringify(moonshotStream))).toEqual({ inputTokens: 40, outputTokens: 9, cachedInputTokens: 0, reasoningTokens: 0 });
    expect(readTokenUsage(JSON.stringify({ output: [] }))).toBeNull();
  });

  test("cost prices fresh input, cached input and output separately; no prices, no cost", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 500_000, cachedInputTokens: 400_000, reasoningTokens: 0 };
    expect(requestCostCents(usage, { inputCentsPerMtok: 250, cachedInputCentsPerMtok: 125, outputCentsPerMtok: 1000 })).toBe(150 + 50 + 500);
    expect(requestCostCents(usage, { inputCentsPerMtok: 250, cachedInputCentsPerMtok: null, outputCentsPerMtok: 1000 })).toBe(250 + 500);
    expect(requestCostCents(usage, { inputCentsPerMtok: null, cachedInputCentsPerMtok: null, outputCentsPerMtok: 1000 })).toBeNull();
  });
});
