import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "@shared/contracts";
import { AppDatabase } from "../../src/main/database";
import { registerCoreAdminHandlers } from "../../src/main/ipc-core-admin-handlers";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("ipc-core-admin-handlers connector saves", () => {
  it("accepts compatible connector model catalogs stored as csv", async () => {
    const profileDir = await createTempDir("agentcompany-admin-handler-");
    const db = new AppDatabase(profileDir);
    db.init();

    const handlers = new Map<string, (...args: any[]) => any>();
    registerCoreAdminHandlers({
      registerHandle: (channel, handler) => {
        handlers.set(channel, handler);
      },
      db,
      ensureCompanyExists: () => null,
      publishDomainChanged: vi.fn(),
      handleApprovalResolved: vi.fn(),
      checkConnector: vi.fn(),
      openConnectorAuthTerminal: vi.fn(),
      openGenericTerminal: vi.fn(),
    });

    const saveConnector = handlers.get(IPC_CHANNELS.saveConnector);
    if (!saveConnector) {
      throw new Error("saveConnector handler was not registered.");
    }

    const result = await saveConnector(null, {
      id: "claude_compatible",
      command: "claude",
      model: "model-alpha,model-beta,model-gamma",
      envBindingText: "ANTHROPIC_BASE_URL=https://example.com/anthropic",
      notes: "Compat provider",
    }) as { ok: boolean; error?: { code: string; message: string } };

    expect(result.ok).toBe(true);
    expect(db.getConnector("claude_compatible").model).toBe("model-alpha,model-beta,model-gamma");

    db.close();
  });
});
