import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAgentToken,
  initializeAgentTokenSigningKey,
  validateAgentToken,
} from "../../src/main/agent-auth";
import { FatalError } from "../../src/main/errors";

const tempDirs: string[] = [];

async function createTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "agentcompany-agent-auth-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createSignedRawPayloadToken(profileDir: string, rawPayload: string): Promise<string> {
  const key = await readFile(join(profileDir, "agent-api-signing.key"));
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(rawPayload).toString("base64url");
  const signature = createHmac("sha256", key)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

describe("agent token signing key", () => {
  it("keeps existing run tokens valid across profile reinitialization", async () => {
    const profileDir = await createTempDir();
    initializeAgentTokenSigningKey(profileDir);
    const token = createAgentToken("agent-1", "company-1", "run-1");

    initializeAgentTokenSigningKey(profileDir);

    expect(validateAgentToken(token)).toMatchObject({
      agentId: "agent-1",
      companyId: "company-1",
      runId: "run-1",
    });
  });

  it("treats a corrupt signing key as fatal state", async () => {
    const profileDir = await createTempDir();
    await writeFile(join(profileDir, "agent-api-signing.key"), Buffer.from("too-short"));

    expect(() => initializeAgentTokenSigningKey(profileDir)).toThrow(FatalError);
  });

  it("logs malformed signed token context without token fingerprints", async () => {
    const profileDir = await createTempDir();
    initializeAgentTokenSigningKey(profileDir);
    const rawPayload = "{malformed-token-body";
    const token = await createSignedRawPayloadToken(profileDir, rawPayload);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(validateAgentToken(token, {
      runId: "run-1",
      companyId: "company-1",
      requestId: "req-1",
    })).toBeNull();

    expect(warn).toHaveBeenCalledWith(
      "[agent-auth] token shape invalid: reason=payload_json_parse_failed runId=run-1 companyId=company-1 requestId=req-1",
    );
    const logLine = String(warn.mock.calls[0]?.[0] ?? "");
    expect(logLine).not.toContain(rawPayload);
    expect(logLine).not.toContain(token.slice(0, 8));
  });
});
