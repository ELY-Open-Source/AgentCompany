import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Lightweight HMAC-based agent token system.
 * Tokens are short-lived and scoped to a specific agent + company + run.
 * No external JWT library needed.
 */

const SIGNING_KEY = randomBytes(32);
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

interface TokenPayload {
  agentId: string;
  companyId: string;
  runId: string;
  iat: number;
  exp: number;
}

function sign(payload: TokenPayload): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", SIGNING_KEY)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

function verify(token: string): TokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts as [string, string, string];

  const expectedSignature = createHmac("sha256", SIGNING_KEY)
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

export function createAgentToken(agentId: string, companyId: string, runId: string): string {
  const now = Date.now();
  return sign({ agentId, companyId, runId, iat: now, exp: now + TOKEN_TTL_MS });
}

export function validateAgentToken(token: string): TokenPayload | null {
  return verify(token);
}

export type { TokenPayload };
