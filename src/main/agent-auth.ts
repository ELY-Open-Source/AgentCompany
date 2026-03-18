import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

let signingKey: Buffer | null = null;
const TOKEN_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

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
  } catch {
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
  const keyPath = join(profileDir, "agent-api-signing.key");
  mkdirSync(profileDir, { recursive: true });
  try {
    const nextKey = randomBytes(32);
    writeFileSync(keyPath, nextKey, { flag: "wx", mode: 0o600 });
    signingKey = nextKey;
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") {
      throw error;
    }
  }
  const persistedKey = readFileSync(keyPath);
  if (persistedKey.length !== 32) {
    throw new Error(`Invalid agent API signing key length at ${keyPath}. Expected 32 bytes, received ${persistedKey.length}.`);
  }
  signingKey = persistedKey;
}

export function createAgentToken(agentId: string, companyId: string, runId: string): string {
  const now = Date.now();
  return sign({ agentId, companyId, runId, iat: now, exp: now + TOKEN_TTL_MS });
}

export function validateAgentToken(token: string): TokenPayload | null {
  return verify(token);
}

export type { TokenPayload };
