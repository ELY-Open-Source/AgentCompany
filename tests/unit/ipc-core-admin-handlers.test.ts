import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import type { DesktopResult } from "@shared/contracts";
import { IPC_CHANNELS } from "@shared/contracts";
import { AppDatabase } from "../../src/main/database";
import { registerCoreAdminHandlers } from "../../src/main/ipc-core-admin-handlers";

type IpcHandler = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => Promise<DesktopResult<unknown>> | DesktopResult<unknown>;

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
  it("accepts a valid pi-ai model for a pi-mono connector", async () => {
    const profileDir = await createTempDir("agentcompany-admin-handler-");
    const db = new AppDatabase(profileDir);
    db.init();

    const { getModels } = await import("@mariozechner/pi-ai");
    const anthropicModel = getModels("anthropic" as never)[0]?.id;
    if (!anthropicModel) {
      throw new Error("pi-ai anthropic provider must expose at least one model.");
    }

    const handlers = new Map<string, IpcHandler>();
    registerCoreAdminHandlers({
      registerHandle: (channel, handler) => {
        handlers.set(channel, handler);
      },
      db,
      ensureCompanyExists: () => null,
      publishDomainChanged: vi.fn(),
      handleApprovalResolved: vi.fn(),
      checkConnector: vi.fn(),
      openGenericTerminal: vi.fn(),
    });

    const saveConnector = handlers.get(IPC_CHANNELS.saveConnector);
    if (!saveConnector) {
      throw new Error("saveConnector handler was not registered.");
    }

    const result = await saveConnector(null as unknown as IpcMainInvokeEvent, {
      id: "anthropic",
      model: anthropicModel,
      envBindingText: "ANTHROPIC_BASE_URL=https://example.com/anthropic",
      notes: "Pi-mono connector",
    }) as { ok: boolean; error?: { code: string; message: string } };

    expect(result.ok).toBe(true);
    expect(db.connectorsCrud.getConnector("anthropic").model).toBe(anthropicModel);

    db.close();
  });
});
