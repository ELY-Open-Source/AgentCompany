import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "../../src/main/database";
import { CredentialStore } from "../../src/main/credentials/credential-store";
import { OAuthLoginService } from "../../src/main/credentials/oauth-login-service";

vi.mock("electron", () => ({
  shell: { openExternal: vi.fn(async () => true) },
}));

beforeAll(() => {
  process.env.AGENTCOMPANY_ALLOW_INSECURE_VAULT = "true";
});

const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe("OAuthLoginService", () => {
  let tempDir: string;
  let db: AppDatabase;
  let store: CredentialStore;
  let service: OAuthLoginService;
  const emit = vi.fn();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-oauth-service-"));
    db = new AppDatabase(tempDir);
    db.init();
    store = new CredentialStore({ db });
    service = new OAuthLoginService({
      store,
      emitEvent: emit,
      refreshConnectorHealth: async () => {},
      logger: noopLogger,
    });
    emit.mockClear();
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("rejects start() for a non-OAuth connector", async () => {
    await expect(service.start("anthropic")).rejects.toThrow(/does not use OAuth/);
  });

  it("rejects start() for an unknown connector id", async () => {
    await expect(service.start("definitely-not-a-connector")).rejects.toThrow(/Unknown connector/);
  });

  it("submitPromptResponse returns false when there is no pending prompt", () => {
    expect(service.submitPromptResponse("nonexistent-request-id", "value")).toBe(false);
  });

  it("submitManualCode returns false when there is no pending request", () => {
    expect(service.submitManualCode("nonexistent-request-id", "code")).toBe(false);
  });

  it("cancel() of a connector with no active flow is a no-op (does not throw)", () => {
    expect(() => service.cancel("claude-pro")).not.toThrow();
  });
});
