import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FatalError } from "./errors/index.js";

let signingKey: Buffer | null = null;
const TOKEN_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours
const SIGNING_KEY_BYTES = 32;

// Once-per-process warning when a malformed token shape is seen. Helps
// diagnose schema breaks after upgrades.
let loggedMalformedTokenWarning = false;

interface TokenValidationLogContext {
  runId?: string | null;
  companyId?: string | null;
  requestId?: string | null;
}

function safeAuthLogField(value: string | null | undefined): string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,160}$/.test(value) ? value : "unknown";
}

function warnMalformedTokenOnce(reason: string, context: TokenValidationLogContext | undefined) {
  if (loggedMalformedTokenWarning) return;
  loggedMalformedTokenWarning = true;

  console.warn(
    "[agent-auth] token shape invalid: " +
      `reason=${safeAuthLogField(reason)} ` +
      `runId=${safeAuthLogField(context?.runId)} ` +
      `companyId=${safeAuthLogField(context?.companyId)} ` +
      `requestId=${safeAuthLogField(context?.requestId)}`,
  );
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

function verify(token: string, context?: TokenValidationLogContext): TokenPayload | null {
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
    warnMalformedTokenOnce("payload_json_parse_failed", context);
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
  mkdirSync(profileDir, { recursive: true });
  const keyPath = join(profileDir, "agent-api-signing.key");
  let key: Buffer;
  try {
    key = readFileSync(keyPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    key = randomBytes(SIGNING_KEY_BYTES);
    writeFileSync(keyPath, key, { mode: 0o600, flag: "wx" });
  }
  if (key.length !== SIGNING_KEY_BYTES) {
    throw new FatalError({
      code: "agent_auth.signing_key.invalid",
      message: `Agent token signing key must be ${SIGNING_KEY_BYTES} bytes.`,
      context: { keyPath, actualBytes: key.length },
    });
  }
  chmodSync(keyPath, 0o600);
  signingKey = key;
}

export function createAgentToken(agentId: string, companyId: string, runId: string): string {
  const now = Date.now();
  return sign({ agentId, companyId, runId, iat: now, exp: now + TOKEN_TTL_MS });
}

export function validateAgentToken(token: string, context?: TokenValidationLogContext): TokenPayload | null {
  return verify(token, context);
}

export type { TokenPayload, TokenValidationLogContext };
