/**
 * Mints a Google Cloud access token from a service-account JSON by signing a
 * JWT (RS256) and exchanging it at the OAuth token endpoint. Tokens are cached
 * per service account until shortly before expiry.
 */
import { createSign } from "node:crypto";
import { httpFailure } from "../provider-http";
import { oauthFetch } from "../oauth/oauth-fetch";

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

const TOKEN_CACHE = new Map<string, { token: string; expiresAt: number }>();

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

export async function getGcpAccessToken(serviceAccountJson: string): Promise<string> {
  let account: ServiceAccount;
  try {
    account = JSON.parse(serviceAccountJson) as ServiceAccount;
  } catch {
    throw new Error("Vertex service-account credential is not valid JSON.");
  }
  if (typeof account.client_email !== "string" || typeof account.private_key !== "string") {
    throw new Error("Vertex service-account JSON is missing client_email or private_key.");
  }
  const cached = TOKEN_CACHE.get(account.client_email);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${claims}`;
  const signature = base64url(createSign("RSA-SHA256").update(signingInput).sign(account.private_key));
  const assertion = `${signingInput}.${signature}`;

  const { response, text } = await oauthFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) throw httpFailure(`Vertex authentication failed: ${response.status} ${text}`, response, text);
  const json = JSON.parse(text) as { access_token?: unknown; expires_in?: unknown };
  if (typeof json.access_token !== "string" || typeof json.expires_in !== "number") {
    throw new Error("Vertex authentication response was missing an access token.");
  }
  TOKEN_CACHE.set(account.client_email, { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 - 60 * 1000 });
  return json.access_token;
}
