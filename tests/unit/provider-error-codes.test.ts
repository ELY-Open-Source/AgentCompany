import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { classifyProviderFailure } from "../../src/main/services/provider-failure";
import { refreshCodex } from "../../src/main/services/oauth/openai-codex-flow";
import { refreshKimiCode } from "../../src/main/services/oauth/kimi-code-flow";
import { postJson, ProviderHttpError } from "../../src/main/services/provider-http";
import { accumulateResponsesStream } from "../../src/main/services/provider-tool-turns/responses-format";
import { accumulateGeminiStream } from "../../src/main/services/provider-tool-turns/gemini-format";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { markModelChecked } from "../helpers/model-check";
import { PROVIDER_DATA_POLICY, PROVIDER_EXECUTION_MODE } from "../../src/shared/domain";
import { mapAnthropicMessageStream, mapOpenAiChatCompletionStream, mapOpenAiResponseStream } from "../../src/main/services/provider-streaming";
import { PROVIDER_MONTHLY_LIMIT_MESSAGE } from "../../src/shared/provider-runtime-domain";

const NOW = Date.parse("2026-10-08T12:00:00.000Z");

async function httpFailure(status: number, body: unknown, headers: Record<string, string> = {}): Promise<ProviderHttpError> {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } }));
  const error = await postJson("https://provider.test/v1", {}, {}).catch((caught: unknown) => caught);
  if (!(error instanceof ProviderHttpError)) throw new Error("expected a provider HTTP error");
  return error;
}

afterEach(() => vi.unstubAllGlobals());

describe("provider errors keep their status and machine code", () => {
  test("each provider's error code is read from where it puts it", async () => {
    expect(await httpFailure(400, { error: { message: "bad", type: "invalid_request_error", code: "context_length_exceeded" } })).toMatchObject({ status: 400, code: "context_length_exceeded" });
    expect(await httpFailure(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } })).toMatchObject({ status: 529, code: "overloaded_error" });
    expect(await httpFailure(429, { error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" } })).toMatchObject({ status: 429, code: "RESOURCE_EXHAUSTED" });
    expect(await httpFailure(400, { message: "Rate exceeded" }, { "x-amzn-ErrorType": "ThrottlingException:http://internal.amazon.com/coral/com.amazon.bedrock/" })).toMatchObject({ status: 400, code: "ThrottlingException" });
    expect(await httpFailure(500, { oops: true })).toMatchObject({ status: 500, code: null });
  });

  test("a token refresh the provider rate-limits is a structured, transient failure", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { code: "rate_limit_exceeded", message: "slow down" } }), { status: 429, headers: { "content-type": "application/json", "retry-after": "30" } }));
    const failure = await refreshCodex("refresh-token").catch((caught: unknown) => caught);
    expect(failure).toMatchObject({ status: 429, code: "rate_limit_exceeded" });
    expect(classifyProviderFailure(failure, NOW)).toEqual({ transient: true, retryAfterMs: 30_000 });
  });

  test("OAuth error tokens are codes, sentences are not; Kimi's refresh keeps status, wait and code even without JSON", async () => {
    expect(await httpFailure(400, { error: "invalid_grant", error_description: "expired" })).toMatchObject({ status: 400, code: "invalid_grant" });
    expect(await httpFailure(400, { error: "Rate limit exceeded, slow down" })).toMatchObject({ code: null });
    vi.stubGlobal("fetch", async () => new Response("<html>busy</html>", { status: 503, headers: { "retry-after": "300" } }));
    const busy = await refreshKimiCode("refresh-token").catch((caught: unknown) => caught);
    expect(busy).toMatchObject({ status: 503 });
    expect(classifyProviderFailure(busy, NOW)).toEqual({ transient: true, retryAfterMs: 300_000 });
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "rate_limited" }), { status: 429, headers: { "content-type": "application/json", "retry-after": "30" } }));
    const limited = await refreshKimiCode("refresh-token").catch((caught: unknown) => caught);
    expect(limited).toMatchObject({ status: 429, code: "rate_limited" });
    expect(classifyProviderFailure(limited, NOW).retryAfterMs).toBe(30_000);
  });

  test("a provider's transient code is transient even under a status that is not", async () => {
    expect(classifyProviderFailure(await httpFailure(400, { message: "Rate exceeded" }, { "x-amzn-ErrorType": "ThrottlingException:x" }), NOW).transient).toBe(true);
    expect(classifyProviderFailure(await httpFailure(400, { error: { type: "invalid_request_error", message: "rate limit in prompt" } }), NOW).transient).toBe(false);
  });

  test("stream errors carry the provider's code, not a status made up for it", async () => {
    async function* events(data: Record<string, unknown>) { yield { eventName: null, data, rawData: JSON.stringify(data) }; }
    const codex = await accumulateResponsesStream(events({ type: "error", error: { type: "usage_limit_reached", message: "The usage limit has been reached" } })).catch((caught: unknown) => caught);
    expect(codex).toMatchObject({ status: null, code: "usage_limit_reached" });
    expect(classifyProviderFailure(codex, NOW).transient).toBe(true);
    const gemini = await accumulateGeminiStream(events({ error: { code: 503, message: "busy", status: "UNAVAILABLE" } })).catch((caught: unknown) => caught);
    expect(gemini).toMatchObject({ status: 503, code: "UNAVAILABLE" });
  });

  test("a streamed reply's error event keeps the provider's code on the error and the request", async () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-codes-stream-${randomUUID()}.db`));
    const vault = { encryptSecret: (secret: string) => Buffer.from(secret, "utf8"), decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8") };
    async function* overloaded() { const data = { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }; yield { eventName: null, data, rawData: JSON.stringify(data) }; }
    const adapters = { ...providerAdapters, anthropic: { ...providerAdapters.anthropic, streamResponse: async () => ({ events: mapAnthropicMessageStream(overloaded()), rateLimitState: null }) } };
    const providers = new ProviderService(connection.db, adapters, vault);
    let orgId = "";
    let providerId = "";
    connection.transaction(() => {
      orgId = new OrganizationService(connection.db).createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
      providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'anthropic'").get(orgId) as { id: string }).id;
      providers.saveCredential({ orgId, providerId, secret: "sk-ant-test", model: "claude-sonnet-4-5" });
    });
    const failure = await providers.streamResponse({ orgId, providerId, prompt: "p", instructions: null, executionMode: PROVIDER_EXECUTION_MODE.FOREGROUND }, () => {}).catch((caught: unknown) => caught);
    expect(failure).toMatchObject({ message: "Overloaded", code: "overloaded_error" });
    async function* failedResponse() { const data = { type: "response.failed", response: { error: { code: "server_error", message: "The server had an error." } } }; yield { eventName: null, data, rawData: JSON.stringify(data) }; }
    const openAi = new ProviderService(connection.db, { ...adapters, openai: { ...providerAdapters.openai, streamResponse: async () => ({ events: mapOpenAiResponseStream(failedResponse()), rateLimitState: null }) } }, vault);
    const openAiId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
    connection.transaction(() => openAi.saveCredential({ orgId, providerId: openAiId, secret: "sk-test", model: "gpt-5.4" }));
    const serverError = await openAi.streamResponse({ orgId, providerId: openAiId, prompt: "p", instructions: null, executionMode: PROVIDER_EXECUTION_MODE.FOREGROUND }, () => {}).catch((caught: unknown) => caught);
    expect(serverError).toMatchObject({ code: "server_error" });
    expect(classifyProviderFailure(serverError, NOW).transient).toBe(true);

    async function* midStream() { const data = { id: "gen-1", error: { code: 503, message: "Provider unavailable" }, choices: [{ delta: { content: "" }, finish_reason: "error" }] }; yield { eventName: null, data, rawData: JSON.stringify(data) }; }
    const router = new ProviderService(connection.db, { ...adapters, openrouter: { ...providerAdapters.openrouter, streamResponse: async () => ({ events: mapOpenAiChatCompletionStream(midStream()), rateLimitState: null }) } }, vault);
    const routerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openrouter'").get(orgId) as { id: string }).id;
    connection.transaction(() => router.saveCredential({ orgId, providerId: routerId, secret: "sk-or-test", model: "openai/gpt-5.4" }));
    const unavailable = await router.streamResponse({ orgId, providerId: routerId, prompt: "p", instructions: null, executionMode: PROVIDER_EXECUTION_MODE.FOREGROUND }, () => {}).catch((caught: unknown) => caught);
    expect(unavailable).toMatchObject({ message: "Provider unavailable", status: 503 });
    expect(classifyProviderFailure(unavailable, NOW).transient).toBe(true);
    expect(classifyProviderFailure(failure, NOW).transient).toBe(true);
    expect(connection.db.prepare("select error_code from provider_requests order by rowid").all()).toEqual([{ error_code: "overloaded_error" }, { error_code: "server_error" }, { error_code: null }]);
    connection.close();
  });

  test("our own monthly limit is a typed error, and a failed request keeps its status and code", async () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-codes-${randomUUID()}.db`));
    const vault = { encryptSecret: (secret: string) => Buffer.from(secret, "utf8"), decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8") };
    const providers = new ProviderService(connection.db, providerAdapters, vault, async () => { throw new ProviderHttpError("Overloaded", null, 529, false, "overloaded_error"); });
    let orgId = "";
    let providerId = "";
    connection.transaction(() => {
      orgId = new OrganizationService(connection.db).createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
      providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      providers.saveCredential({ orgId, providerId, secret: "sk-test", model: "gpt-5.4" });
      markModelChecked(connection.db, providerId, "gpt-5.4");
    });
    const call = () => providers.runToolTurn({ orgId, providerId, workspaceId: null, instructions: "i", messages: [{ role: "user", text: "u" }], tools: [] });
    await expect(call()).rejects.toThrow("Overloaded");
    expect(connection.db.prepare("select error_status, error_code from provider_requests").get()).toEqual({ error_status: 529, error_code: "overloaded_error" });

    providers.updatePolicy({ orgId, providerId, dataPolicy: PROVIDER_DATA_POLICY.STANDARD, backgroundEnabled: false, monthlyRequestLimit: 1, workspaceScope: "organization", contextWindowTokens: 128_000 });
    const limited = await call().catch((caught: unknown) => caught);
    expect((limited as Error).message).toBe(PROVIDER_MONTHLY_LIMIT_MESSAGE);
    expect(classifyProviderFailure(limited, NOW).transient).toBe(true);
    expect(classifyProviderFailure(new Error((limited as Error).message), NOW).transient).toBe(false);
    connection.close();
  });
});
