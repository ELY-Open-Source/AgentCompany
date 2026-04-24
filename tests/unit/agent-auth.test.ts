import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
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
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

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
});
