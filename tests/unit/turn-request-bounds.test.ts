import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ProviderRequestTimeouts } from "../../src/main/services/provider-http";

const sent: Array<{ streamed: boolean; body: Record<string, unknown>; timeouts: ProviderRequestTimeouts | undefined }> = [];
const STOP = new Error("captured");

vi.mock("../../src/main/services/provider-http", async (original) => ({
  ...(await original<typeof import("../../src/main/services/provider-http")>()),
  postJson: async (_url: string, _headers: unknown, body: Record<string, unknown>, timeouts?: ProviderRequestTimeouts) => { sent.push({ streamed: false, body, timeouts }); throw STOP; },
  postEventStream: async (_url: string, _headers: unknown, body: Record<string, unknown>, timeouts?: ProviderRequestTimeouts) => { sent.push({ streamed: true, body, timeouts }); throw STOP; },
}));
vi.mock("../../src/main/services/provider-tool-turns/gcp-auth", () => ({ getGcpAccessToken: async () => "token" }));

const { selectToolTurn } = await import("../../src/main/services/provider-tool-turns/router");
const { OUTPUT_RESERVE_TOKENS } = await import("../../src/main/services/context-budget");

const credential = {
  apiKey: "k", accessToken: "tid=1;exp=9999999999", accountId: "acct", projectId: "proj", baseUrl: "https://example.test",
  deployment: "dep", region: "us-east-1", accessKeyId: "AKIA", secretAccessKey: "secret", serviceAccountJson: "{}",
};

async function capture(providerKey: string, model = "m"): Promise<(typeof sent)[number]> {
  await expect(selectToolTurn(providerKey)({ credential, model, instructions: null, messages: [{ role: "user", text: "hi" }], tools: [] })).rejects.toBe(STOP);
  const request = sent.at(-1);
  if (!request) throw new Error(`${providerKey} sent nothing`);
  return request;
}

/** The output cap a request carries, whatever the API calls it. */
function outputCap(body: Record<string, unknown>): unknown {
  const request = (body.request ?? body) as Record<string, unknown>;
  const generation = request.generationConfig as Record<string, unknown> | undefined;
  const inference = body.inferenceConfig as Record<string, unknown> | undefined;
  return body.max_output_tokens ?? body.max_tokens ?? body.max_completion_tokens ?? generation?.maxOutputTokens ?? inference?.maxTokens ?? null;
}

beforeEach(() => { sent.length = 0; });

describe("every agent turn has the same output cap and a wait that fits how it is sent", () => {
  test("each provider caps output at the reserve the context budget keeps, in the field its API names", async () => {
    const fields: Record<string, string> = {
      openai: "max_output_tokens", "github-copilot": "max_output_tokens",
      anthropic: "max_tokens", "claude-pro": "max_tokens", "custom-anthropic": "max_tokens",
      xai: "max_completion_tokens", groq: "max_completion_tokens", cerebras: "max_completion_tokens", "azure-openai": "max_completion_tokens",
      mistral: "max_tokens", openrouter: "max_tokens", kimi: "max_tokens", "kimi-cn": "max_tokens", "kimi-code": "max_tokens",
    };
    for (const [key, field] of Object.entries(fields)) {
      const { body } = await capture(key);
      expect([key, body[field]]).toEqual([key, OUTPUT_RESERVE_TOKENS]);
    }
    expect(outputCap((await capture("google-antigravity", "gemini-3-pro")).body)).toBe(OUTPUT_RESERVE_TOKENS);
    expect(outputCap((await capture("vertex-ai", "gemini-3-pro")).body)).toBe(OUTPUT_RESERVE_TOKENS);
    expect(outputCap((await capture("aws-bedrock", "anthropic.claude-sonnet-4-5")).body)).toBe(OUTPUT_RESERVE_TOKENS);
  });

  test("Codex, custom OpenAI endpoints and non-Claude Bedrock models get no cap: none taken, field unknown, or limits that differ per model", async () => {
    expect(outputCap((await capture("gpt-account")).body)).toBeNull();
    expect(outputCap((await capture("custom-openai")).body)).toBeNull();
    expect(outputCap((await capture("aws-bedrock", "meta.llama3-70b-instruct-v1:0")).body)).toBeNull();
  });

  test("turns that wait for a whole response allow a long think before headers; streamed turns keep the idle deadline", async () => {
    for (const key of ["openai", "anthropic", "claude-pro", "github-copilot", "custom-openai", "custom-anthropic", "azure-openai", "aws-bedrock", "vertex-ai"]) {
      const { streamed, timeouts } = await capture(key);
      expect([key, streamed, timeouts?.headersTimeoutMs]).toEqual([key, false, 300_000]);
    }
    for (const key of ["xai", "kimi-code", "gpt-account", "google-antigravity"]) {
      const { streamed, timeouts } = await capture(key);
      expect([key, streamed, timeouts?.headersTimeoutMs]).toEqual([key, true, undefined]);
    }
  });
});
