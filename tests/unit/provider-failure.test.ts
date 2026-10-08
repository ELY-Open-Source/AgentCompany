import { describe, expect, test } from "vitest";
import { classifyProviderFailure } from "../../src/main/services/provider-failure";
import { ProviderHttpError } from "../../src/main/services/provider-http";
import { accumulateChatStream } from "../../src/main/services/provider-tool-turns/chat-format";
import { accumulateResponsesStream } from "../../src/main/services/provider-tool-turns/responses-format";

const NOW = Date.parse("2026-10-08T12:00:00.000Z");
const limits = (retryAfterMs: number | null, resetAt: string | null) => ({ requestLimit: null, remainingRequests: 0, resetAt, retryAfterMs, rawStateJson: "{}" });

describe("provider failure classification", () => {
  test("status, timeouts and network codes decide, whatever the message says", () => {
    expect(classifyProviderFailure(new ProviderHttpError("slow down", limits(45_000, null), 429), NOW)).toEqual({ transient: true, retryAfterMs: 45_000 });
    expect(classifyProviderFailure(new ProviderHttpError("", limits(null, "2026-10-08T12:05:00.000Z"), 503), NOW)).toEqual({ transient: true, retryAfterMs: 300_000 });
    expect(classifyProviderFailure(new ProviderHttpError("{\"type\":\"overloaded_error\"}", null, 529), NOW)).toEqual({ transient: true, retryAfterMs: null });
    expect(classifyProviderFailure(new ProviderHttpError("Provider request timed out.", null, null, true), NOW)).toEqual({ transient: true, retryAfterMs: null });
    expect(classifyProviderFailure(new ProviderHttpError("invalid api key", null, 401), NOW)).toEqual({ transient: false, retryAfterMs: null });
    expect(classifyProviderFailure(new ProviderHttpError("The usage limit has been reached", null, 400), NOW)).toEqual({ transient: true, retryAfterMs: null });
    const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    expect(classifyProviderFailure(new TypeError("fetch failed", { cause: reset }), NOW)).toEqual({ transient: true, retryAfterMs: null });
    expect(classifyProviderFailure(new ProviderHttpError("", null, 522), NOW)).toEqual({ transient: true, retryAfterMs: null });
    expect(classifyProviderFailure(new Error("Agent has no enabled skills."), NOW)).toEqual({ transient: false, retryAfterMs: null });
  });

  test("an error event inside a chat stream keeps its status code", async () => {
    async function* stream() {
      yield { eventName: null, data: { error: { code: 500, message: "Internal server error" } }, rawData: "{}" };
    }
    const failure = await accumulateChatStream(stream()).catch((error: unknown) => error);
    expect(classifyProviderFailure(failure, NOW)).toEqual({ transient: true, retryAfterMs: null });
  });

  test("a failed Responses stream keeps its server_error and rate-limit codes", async () => {
    async function* failed(code: string) {
      yield { eventName: null, data: { type: "response.failed", response: { error: { code, message: "The server had an error." } } }, rawData: "{}" };
    }
    const serverError = await accumulateResponsesStream(failed("server_error")).catch((error: unknown) => error);
    expect((serverError as Error).message).toBe("The server had an error.");
    expect(classifyProviderFailure(serverError, NOW)).toEqual({ transient: true, retryAfterMs: null });
    expect(classifyProviderFailure(await accumulateResponsesStream(failed("rate_limit_exceeded")).catch((error: unknown) => error), NOW).transient).toBe(true);
    expect(classifyProviderFailure(await accumulateResponsesStream(failed("invalid_prompt")).catch((error: unknown) => error), NOW).transient).toBe(false);
  });
});
