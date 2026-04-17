import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

let signingKey: Buffer | null = null;
const TOKEN_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

// Once-per-process warning when a malformed token shape is seen. Helps
// diagnose schema breaks after upgrades — without leaking the full token.
let loggedMalformedTokenWarning = false;
function warnMalformedTokenOnce(token: string, reason: string) {
  if (loggedMalformedTokenWarning) return;
  loggedMalformedTokenWarning = true;
  const fingerprint = token.slice(0, 8);
   
  console.warn(`[agent-auth] token shape invalid (${reason}); first8="${fingerprint}..."`);
}

interface TokenPayload {
  agentId: string;
  companyId: string;
  runId: string;
  iat: number;
  exp: number;
}

function sign(payload: TokenPayload): string {
  const key = getSigningKey();
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", key)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

function verify(token: string): TokenPayload | null {
  const key = getSigningKey();
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts as [string, string, string];

  const expectedSignature = createHmac("sha256", key)
    .update(`${header}.${body}`)
    .digest("base64url");

  const sigBuffer = Buffer.from(signature, "base64url");
  const expectedBuffer = Buffer.from(expectedSignature, "base64url");
  if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as TokenPayload;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    warnMalformedTokenOnce(token, reason);
    return null;
  }
}

function getSigningKey() {
  if (!signingKey) {
    throw new Error("Agent token signing key was used before initialization.");
  }
  return signingKey;
}

export function initializeAgentTokenSigningKey(profileDir: string) {
  // Rotate the signing key on every launch. Any token issued by a prior
  // process becomes unverifiable — agent sessions re-authenticate when
  // they resume, so the cost of invalidating in-flight tokens is bounded
  // and the blast radius of a leaked key is "until next restart".
  mkdirSync(profileDir, { recursive: true });
  const keyPath = join(profileDir, "agent-api-signing.key");
  const nextKey = randomBytes(32);
  writeFileSync(keyPath, nextKey, { mode: 0o600 });
  signingKey = nextKey;
}

export function createAgentToken(agentId: string, companyId: string, runId: string): string {
  const now = Date.now();
  return sign({ agentId, companyId, runId, iat: now, exp: now + TOKEN_TTL_MS });
}

export function validateAgentToken(token: string): TokenPayload | null {
  return verify(token);
}

export type { TokenPayload };
