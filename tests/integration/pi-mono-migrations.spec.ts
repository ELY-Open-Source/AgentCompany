import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { AppDatabase } from "../../src/main/database";

beforeAll(() => {
  // SecretVault gated for test contexts. Used by the credentials path
  // touched by migration 28's downstream consumers.
  process.env.AGENTCOMPANY_ALLOW_INSECURE_VAULT = "true";
});

const tempDirs: string[] = [];

async function freshProfile(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * Migration 27 (`session_entries`) and 28 (`credentials`) ship in the rebuild.
 * These tests verify both migrations:
 *  - run cleanly on a fresh SQLite profile;
 *  - are idempotent on subsequent `init()` calls (existing-user upgrade);
 *  - leave their tables queryable.
 */
describe("pi-mono migrations 27 + 28", () => {
  it("creates session_entries on first init and accepts inserts", async () => {
    const dir = await freshProfile("agentcompany-migration-27-fresh-");
    const db = new AppDatabase(dir);
    db.init();

    db.sessionEntries.append({
      taskSessionId: "test-session",
      kind: "message",
      role: "user",
      payloadJson: JSON.stringify({ role: "user", content: "hello" }),
    });
    const rows = db.sessionEntries.listActive("test-session");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("message");
    db.close();
  });

  it("creates credentials on first init and accepts encrypted inserts", async () => {
    const dir = await freshProfile("agentcompany-migration-28-fresh-");
    const db = new AppDatabase(dir);
    db.init();

    const cipher = db.vault.encrypt(JSON.stringify({ source: "literal", value: "sk-test-1234567890" }));
    db.credentialsTable.upsert({
      connectorId: "test-anthropic",
      kind: "api_key",
      backend: cipher.backend,
      ciphertext: cipher.payload,
      displayHint: "sk-test-...7890",
      status: "active",
      expiresAt: null,
      lastRefreshedAt: null,
      lastError: null,
    });

    const rows = db.credentialsTable.list();
    expect(rows.some((row) => row.connectorId === "test-anthropic")).toBe(true);
    db.close();
  });

  it("re-running init() on an existing profile does not re-apply migrations or duplicate rows", async () => {
    const dir = await freshProfile("agentcompany-migration-idempotent-");
    const dbA = new AppDatabase(dir);
    dbA.init();
    dbA.sessionEntries.append({
      taskSessionId: "session-x",
      kind: "message",
      role: "user",
      payloadJson: JSON.stringify({ role: "user", content: "first" }),
    });
    const cipher = dbA.vault.encrypt(JSON.stringify({ source: "literal", value: "sk-keep-me" }));
    dbA.credentialsTable.upsert({
      connectorId: "test-keep",
      kind: "api_key",
      backend: cipher.backend,
      ciphertext: cipher.payload,
      displayHint: "sk-keep-...e",
      status: "active",
      expiresAt: null,
      lastRefreshedAt: null,
      lastError: null,
    });
    dbA.close();

    const dbB = new AppDatabase(dir);
    dbB.init();
    expect(dbB.sessionEntries.listActive("session-x")).toHaveLength(1);
    expect(dbB.credentialsTable.list().filter((row) => row.connectorId === "test-keep")).toHaveLength(1);
    dbB.close();
  });

  it("seedConnectors prunes legacy connector rows and inserts the full pi-mono + Fireworks catalog", async () => {
    const dir = await freshProfile("agentcompany-migration-seed-");
    const db = new AppDatabase(dir);
    db.init();

    const rows = db.listSnapshot().connectors.map((entry) => entry.id);
    expect(rows.length).toBe(26);
    expect(rows).toContain("claude-pro");
    expect(rows).toContain("amazon-bedrock");
    expect(rows).toContain("google-vertex");
    expect(rows).toContain("fireworks");
    expect(rows).toContain("fireworks-firepass");
    expect(rows.find((id) => (id as string) === "claude_local")).toBeUndefined();
    expect(rows.find((id) => (id as string) === "codex_local")).toBeUndefined();
    expect(rows.find((id) => (id as string) === "claude_compatible")).toBeUndefined();
    db.close();
  });
});
