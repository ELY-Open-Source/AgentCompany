import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../../src/main/database";
import { CredentialStore, CredentialStoreReadError } from "../../src/main/credentials/credential-store";

beforeAll(() => {
  // SecretVault throws unless safeStorage is available or this gate is set.
  // safeStorage is unavailable inside vitest, so we use the test-only path.
  process.env.AGENTCOMPANY_ALLOW_INSECURE_VAULT = "true";
});

describe("CredentialStore", () => {
  let tempDir: string;
  let db: AppDatabase;
  let store: CredentialStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-credential-store-"));
    db = new AppDatabase(tempDir);
    db.init();
    store = new CredentialStore({ db });
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("round-trips an api_key literal credential", () => {
    const summary = store.save("anthropic", { kind: "api_key", value: { source: "literal", value: "sk-ant-test1234567890abcd" } });
    expect(summary.kind).toBe("api_key");
    expect(summary.status).toBe("active");
    expect(summary.displayHint).toContain("...");
    expect(summary.displayHint).not.toContain("test1234567890");

    const decrypted = store.read("anthropic");
    expect(decrypted).not.toBeNull();
    expect(decrypted!.kind).toBe("api_key");
    if (decrypted!.kind === "api_key") {
      expect(decrypted!.value.source).toBe("literal");
      expect(decrypted!.value.value).toBe("sk-ant-test1234567890abcd");
    }
  });

  it("round-trips an aws credential with bearer mode", () => {
    store.save("amazon-bedrock", {
      kind: "aws",
      value: {
        authMode: "bearer",
        region: "us-east-2",
        bearerToken: "bedrock-bearer-xyz",
      },
    });
    const decrypted = store.read("amazon-bedrock");
    expect(decrypted?.kind).toBe("aws");
    if (decrypted?.kind === "aws") {
      expect(decrypted.value.authMode).toBe("bearer");
      expect(decrypted.value.region).toBe("us-east-2");
      expect(decrypted.value.bearerToken).toBe("bedrock-bearer-xyz");
    }
  });

  it("round-trips an oauth credential through the read schema", () => {
    store.save("claude-pro", {
      kind: "oauth",
      value: {
        refresh: "refresh-token",
        access: "access-token",
        expires: Date.now() + 60_000,
        domain: "anthropic.com",
      },
    });

    const decrypted = store.read("claude-pro");
    expect(decrypted?.kind).toBe("oauth");
    if (decrypted?.kind === "oauth") {
      expect(decrypted.value.refresh).toBe("refresh-token");
      expect(decrypted.value.access).toBe("access-token");
      expect(decrypted.value.domain).toBe("anthropic.com");
    }
  });

  it("rejects stored credentials whose decrypted payload does not match the row kind", () => {
    const encrypted = db.vault.encrypt(JSON.stringify({ source: "literal", value: "sk-test-abcdefghij" }));
    db.core.credentials.upsert({
      connectorId: "amazon-bedrock",
      kind: "aws",
      backend: encrypted.backend,
      ciphertext: encrypted.payload,
      displayHint: "bad",
      status: "active",
    });

    let thrown: unknown;
    try {
      store.read("amazon-bedrock");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CredentialStoreReadError);
    expect(thrown).toMatchObject({
      code: "CREDENTIAL_INVALID",
      context: { connectorId: "amazon-bedrock" },
    });
    expect(thrown).toHaveProperty("message", expect.stringContaining("failed schema validation"));
  });

  it("rejects stored credentials whose ciphertext is not valid JSON", () => {
    const encrypted = db.vault.encrypt("{not-json");
    db.core.credentials.upsert({
      connectorId: "anthropic",
      kind: "api_key",
      backend: encrypted.backend,
      ciphertext: encrypted.payload,
      displayHint: "bad",
      status: "active",
    });

    let thrown: unknown;
    try {
      store.read("anthropic");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CredentialStoreReadError);
    expect(thrown).toMatchObject({
      code: "CREDENTIAL_INVALID",
      context: { connectorId: "anthropic" },
    });
    expect(thrown).toHaveProperty("message", "Stored credential payload is not valid JSON.");
  });

  it("removes a credential", () => {
    store.save("openai", { kind: "api_key", value: { source: "literal", value: "sk-test-abcdefghij" } });
    expect(store.list().some((row) => row.connectorId === "openai")).toBe(true);
    store.remove("openai");
    expect(store.list().some((row) => row.connectorId === "openai")).toBe(false);
    expect(store.read("openai")).toBeNull();
  });

  it("setStatus updates the status row without losing ciphertext", () => {
    store.save("groq", { kind: "api_key", value: { source: "env", value: "GROQ_API_KEY" } });
    store.setStatus("groq", "expired", "refresh failed");
    const row = store.list().find((entry) => entry.connectorId === "groq");
    expect(row?.status).toBe("expired");
    expect(row?.lastError).toBe("refresh failed");
  });
});
