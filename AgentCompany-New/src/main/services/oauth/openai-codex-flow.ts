/**
 * OpenAI Codex (ChatGPT Plus/Pro subscription) — authorization-code + PKCE flow.
 *
 * Ported from the reference implementation in @mariozechner/pi-ai. Uses a
 * loopback callback server on the registered redirect URI.
 */
import { startOAuthCallbackServer } from "./oauth-callback-server";
import { generatePkce } from "./pkce";
import type { OAuthCredentials, OAuthFlow, OAuthLoginCallbacks } from "./oauth-types";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CALLBACK_PORT = 1455;
const CALLBACK_PATH = "/auth/callback";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const SCOPE = "openid profile email offline_access";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

function buildAuthorizeUrl(challenge: string, state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", "agentcompany");
  return url.toString();
}

function decodeJwtClaims(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Extract the ChatGPT account id embedded in the access token (unit-tested). */
export function extractAccountId(accessToken: string): string | null {
  const claims = decodeJwtClaims(accessToken);
  const auth = claims?.[JWT_CLAIM_PATH];
  if (auth && typeof auth === "object" && "chatgpt_account_id" in auth) {
    const accountId = (auth as { chatgpt_account_id?: unknown }).chatgpt_account_id;
    if (typeof accountId === "string" && accountId.length > 0) return accountId;
  }
  return null;
}

async function exchangeCode(code: string, verifier: string): Promise<{ access: string; refresh: string; expires: number }> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Token exchange failed: ${response.status} ${text}`);
  }
  const json = (await response.json()) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
  if (typeof json.access_token !== "string" || typeof json.refresh_token !== "string" || typeof json.expires_in !== "number") {
    throw new Error("Token response was missing required fields.");
  }
  return { access: json.access_token, refresh: json.refresh_token, expires: Date.now() + json.expires_in * 1000 };
}

export const openaiCodexFlow: OAuthFlow = {
  providerKey: "gpt-account",
  async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
    const { verifier, challenge } = generatePkce();
    const state = generatePkce().verifier;
    const server = await startOAuthCallbackServer({ port: CALLBACK_PORT, path: CALLBACK_PATH, signal: callbacks.signal });
    try {
      callbacks.onAuth({ url: buildAuthorizeUrl(challenge, state), instructions: "Complete the ChatGPT sign-in in your browser." });
      const result = await server.waitForCode();
      if (result.state && result.state !== state) throw new Error("OAuth state mismatch.");
      const tokens = await exchangeCode(result.code, verifier);
      const accountId = extractAccountId(tokens.access);
      if (!accountId) throw new Error("Could not read the ChatGPT account id from the token.");
      return { access: tokens.access, refresh: tokens.refresh, expires: tokens.expires, accountId };
    } finally {
      server.close();
    }
  },
};
