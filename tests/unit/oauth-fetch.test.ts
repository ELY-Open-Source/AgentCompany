import { afterEach, describe, expect, test, vi } from "vitest";
import { oauthFetch, OAUTH_REQUEST_TIMEOUT_MS } from "../../src/main/services/oauth/oauth-fetch";
import { ProviderHttpError } from "../../src/main/services/provider-http";

/** A server that accepts the connection and never answers, until the request is aborted. */
function stalledServer(): void {
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("sign-in and renewal requests end when they should", () => {
  test("cancelling a sign-in ends the wait on a stalled token exchange", async () => {
    stalledServer();
    const cancel = new AbortController();
    const pending = oauthFetch("https://auth.example.test/token", { method: "POST" }, cancel.signal);
    cancel.abort();
    await expect(pending).rejects.toThrow("Login cancelled");
  });

  test("a stalled exchange or refresh fails as a timeout instead of waiting forever", async () => {
    vi.useFakeTimers();
    stalledServer();
    const pending = oauthFetch("https://auth.example.test/token", { method: "POST" }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(OAUTH_REQUEST_TIMEOUT_MS);
    const failure = await pending;
    expect(failure).toBeInstanceOf(ProviderHttpError);
    expect(failure).toMatchObject({ timedOut: true, message: "Sign-in request to auth.example.test timed out." });
  });

  test("a request that answers returns its status and body", async () => {
    vi.stubGlobal("fetch", async () => new Response("{\"ok\":true}", { status: 200 }));
    const { response, text } = await oauthFetch("https://auth.example.test/token", { method: "POST" });
    expect([response.status, text]).toEqual([200, "{\"ok\":true}"]);
  });
});
