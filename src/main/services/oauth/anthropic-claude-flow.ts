/**
 * Anthropic Claude Pro/Max — authorization-code + PKCE flow.
 *
 * Ported from the reference implementation in @mariozechner/pi-ai. Uses a
 * loopback callback server on the registered redirect URI and a JSON token
 * exchange.
 */
import { startOAuthCallbackServer } from "./oauth-callback-server";
import { generatePkce } from "./pkce";
import type { OAuthCredentials, OAuthFlow, OAuthLoginCallbacks } from "./oauth-types";

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CALLBACK_PORT = 53692;
const CALLBACK_PATH = "/callback";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const SCOPES = "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

function buildAuthorizeUrl(challenge: string, state: string): string {
  const params = new URLSearchParams({
    code: "true",
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

async function exchangeCode(code: string, state: string, verifier: string): Promise<OAuthCredentials> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      state,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Token exchange failed: ${response.status} ${text}`);
  const json = JSON.parse(text) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
  if (typeof json.access_token !== "string" || typeof json.refresh_token !== "string" || typeof json.expires_in !== "number") {
    throw new Error("Token response was missing required fields.");
  }
  return { access: json.access_token, refresh: json.refresh_token, expires: Date.now() + json.expires_in * 1000 - 5 * 60 * 1000 };
}

/** Refresh an expired Claude Pro/Max access token. */
export async function refreshClaudePro(refreshToken: string): Promise<OAuthCredentials> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: refreshToken }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Claude token refresh failed: ${response.status} ${text}`);
  const json = JSON.parse(text) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
  if (typeof json.access_token !== "string" || typeof json.refresh_token !== "string" || typeof json.expires_in !== "number") {
    throw new Error("Claude token refresh response was missing required fields.");
  }
  return { access: json.access_token, refresh: json.refresh_token, expires: Date.now() + json.expires_in * 1000 - 5 * 60 * 1000 };
}

export const anthropicClaudeFlow: OAuthFlow = {
  providerKey: "claude-pro",
  async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
    const { verifier, challenge } = generatePkce();
    const server = await startOAuthCallbackServer({ port: CALLBACK_PORT, path: CALLBACK_PATH, signal: callbacks.signal });
    try {
      callbacks.onAuth({ url: buildAuthorizeUrl(challenge, verifier), instructions: "Complete the Claude sign-in in your browser." });
      const result = await server.waitForCode();
      if (result.state !== verifier) throw new Error("OAuth state mismatch.");
      return await exchangeCode(result.code, result.state, verifier);
    } finally {
      server.close();
    }
  },
};
