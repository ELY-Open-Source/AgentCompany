/**
 * Google Antigravity (Gemini 3 / Claude / GPT-OSS via Google Cloud) —
 * authorization-code + PKCE flow with project discovery.
 *
 * Ported from the reference implementation in @mariozechner/pi-ai.
 */
import { startOAuthCallbackServer } from "./oauth-callback-server";
import { generatePkce } from "./pkce";
import type { OAuthCredentials, OAuthFlow, OAuthLoginCallbacks } from "./oauth-types";

const CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const CLIENT_SECRET_ENV = "AGENTCOMPANY_GOOGLE_ANTIGRAVITY_CLIENT_SECRET";
const CALLBACK_PORT = 51121;
const CALLBACK_PATH = "/oauth-callback";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
];
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CODE_ASSIST_ENDPOINTS = ["https://cloudcode-pa.googleapis.com", "https://daily-cloudcode-pa.sandbox.googleapis.com"];

export function resolveAntigravityClientSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env[CLIENT_SECRET_ENV]?.trim();
  if (!secret) throw new Error(`${CLIENT_SECRET_ENV} is required for Google Antigravity OAuth.`);
  return secret;
}

function buildAuthorizeUrl(challenge: string, state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    prompt: "consent",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function exchangeCode(code: string, verifier: string): Promise<{ access: string; refresh: string; expires: number }> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: resolveAntigravityClientSecret(),
      code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
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
  return { access: json.access_token, refresh: json.refresh_token, expires: Date.now() + json.expires_in * 1000 - 5 * 60 * 1000 };
}

/** Extract a Code Assist project id from a loadCodeAssist response (unit-tested). */
export function readProjectId(payload: Record<string, unknown>): string | null {
  const project = payload.cloudaicompanionProject;
  if (typeof project === "string" && project) return project;
  if (project && typeof project === "object" && "id" in project) {
    const id = (project as { id?: unknown }).id;
    if (typeof id === "string" && id) return id;
  }
  return null;
}

async function discoverProject(accessToken: string): Promise<string> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": "google-api-nodejs-client/9.15.1",
  };
  for (const endpoint of CODE_ASSIST_ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
        method: "POST",
        headers,
        body: JSON.stringify({ metadata: { ideType: "IDE_UNSPECIFIED", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" } }),
      });
      if (response.ok) {
        const projectId = readProjectId((await response.json()) as Record<string, unknown>);
        if (projectId) return projectId;
      }
    } catch {
      // Try the next endpoint.
    }
  }
  throw new Error("Antigravity project discovery failed.");
}

/** Refresh an expired Antigravity access token, retaining the project id. */
export async function refreshAntigravity(refreshToken: string, projectId: string): Promise<OAuthCredentials> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: resolveAntigravityClientSecret(),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Antigravity token refresh failed: ${response.status} ${text}`);
  const json = JSON.parse(text) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
  if (typeof json.access_token !== "string" || typeof json.expires_in !== "number") {
    throw new Error("Antigravity token refresh response was missing required fields.");
  }
  const refresh = typeof json.refresh_token === "string" && json.refresh_token ? json.refresh_token : refreshToken;
  return { access: json.access_token, refresh, expires: Date.now() + json.expires_in * 1000 - 5 * 60 * 1000, projectId };
}

export const antigravityFlow: OAuthFlow = {
  providerKey: "google-antigravity",
  async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
    const { verifier, challenge } = generatePkce();
    const server = await startOAuthCallbackServer({ port: CALLBACK_PORT, path: CALLBACK_PATH, signal: callbacks.signal });
    try {
      callbacks.onAuth({ url: buildAuthorizeUrl(challenge, verifier), instructions: "Complete the Google sign-in in your browser." });
      const result = await server.waitForCode();
      if (result.state !== verifier) throw new Error("OAuth state mismatch.");
      const tokens = await exchangeCode(result.code, verifier);
      callbacks.onProgress?.("Resolving project");
      const projectId = await discoverProject(tokens.access);
      return { access: tokens.access, refresh: tokens.refresh, expires: tokens.expires, projectId };
    } finally {
      server.close();
    }
  },
};
