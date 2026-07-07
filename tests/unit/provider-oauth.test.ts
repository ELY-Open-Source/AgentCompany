import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { interpretPollResponse } from "../../src/main/services/oauth/github-copilot-flow";
import { extractAccountId } from "../../src/main/services/oauth/openai-codex-flow";
import { readProjectId, resolveAntigravityClientSecret } from "../../src/main/services/oauth/google-antigravity-flow";
import { generatePkce } from "../../src/main/services/oauth/pkce";
import { parseAccessToken, parseAccountToken } from "../../src/main/services/provider-auth-profiles";

function makeJwt(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none" })}.${part(claims)}.signature`;
}

describe("github copilot device-code poll interpreter", () => {
  test("returns the token when present", () => {
    expect(interpretPollResponse({ access_token: "ghu_token" })).toEqual({ kind: "token", accessToken: "ghu_token" });
  });

  test("keeps polling while authorization is pending", () => {
    expect(interpretPollResponse({ error: "authorization_pending" })).toEqual({ kind: "pending" });
    expect(interpretPollResponse({})).toEqual({ kind: "pending" });
  });

  test("backs off on slow_down with the provided interval", () => {
    expect(interpretPollResponse({ error: "slow_down", interval: 9 })).toEqual({ kind: "slow_down", intervalSeconds: 9 });
    expect(interpretPollResponse({ error: "slow_down" })).toEqual({ kind: "slow_down", intervalSeconds: null });
  });

  test("fails on terminal errors", () => {
    const decision = interpretPollResponse({ error: "access_denied", error_description: "user declined" });
    expect(decision.kind).toBe("error");
    if (decision.kind === "error") expect(decision.message).toContain("access_denied: user declined");
  });
});

describe("openai codex account id extraction", () => {
  test("reads the chatgpt account id from the token claims", () => {
    const token = makeJwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct_42" } });
    expect(extractAccountId(token)).toBe("acct_42");
  });

  test("returns null when the claim is absent or malformed", () => {
    expect(extractAccountId(makeJwt({ sub: "user" }))).toBeNull();
    expect(extractAccountId("not-a-jwt")).toBeNull();
  });
});

describe("antigravity project discovery", () => {
  test("reads a string or object project id", () => {
    expect(readProjectId({ cloudaicompanionProject: "proj-a" })).toBe("proj-a");
    expect(readProjectId({ cloudaicompanionProject: { id: "proj-b" } })).toBe("proj-b");
  });

  test("returns null when no project is present", () => {
    expect(readProjectId({})).toBeNull();
    expect(readProjectId({ cloudaicompanionProject: {} })).toBeNull();
  });
});

describe("antigravity oauth configuration", () => {
  test("reads the client secret from runtime environment", () => {
    expect(resolveAntigravityClientSecret({ AGENTCOMPANY_GOOGLE_ANTIGRAVITY_CLIENT_SECRET: " live-secret " })).toBe("live-secret");
  });

  test("requires an explicit client secret", () => {
    expect(() => resolveAntigravityClientSecret({})).toThrow("AGENTCOMPANY_GOOGLE_ANTIGRAVITY_CLIENT_SECRET");
  });
});

describe("pkce generation", () => {
  test("produces an S256 challenge for the verifier", () => {
    const { verifier, challenge } = generatePkce();
    expect(verifier).not.toBe("");
    expect(verifier).not.toBe(challenge);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });
});

describe("oauth credential parsing", () => {
  test("accepts a raw token", () => {
    expect(parseAccessToken("ghu_raw")).toEqual({ type: "access_token", accessToken: "ghu_raw" });
    expect(parseAccountToken("chatgpt_raw")).toEqual({ type: "account_token", accessToken: "chatgpt_raw" });
  });

  test("extracts the access token from native OAuth credential JSON", () => {
    const secret = JSON.stringify({ access: "live_token", refresh: "r", expires: 123 });
    expect(parseAccessToken(secret)).toEqual({ type: "access_token", accessToken: "live_token" });
    expect(parseAccountToken(secret)).toEqual({ type: "account_token", accessToken: "live_token" });
  });

  test("rejects credential JSON without an access token", () => {
    expect(() => parseAccessToken(JSON.stringify({ refresh: "r" }))).toThrow("missing an access token");
  });
});
