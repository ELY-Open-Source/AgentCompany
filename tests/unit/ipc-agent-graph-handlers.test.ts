import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import type { DesktopResult } from "@shared/contracts";
import { IPC_CHANNELS } from "@shared/contracts";
import { AppDatabase } from "../../src/main/database";
import { registerCoreAgentGraphHandlers } from "../../src/main/ipc-core-agent-graph-handlers";

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

describe("ipc-core-agent-graph-handlers model enforcement", () => {
  it("rejects saveAgent when the selected model is disabled for the connector", async () => {
    const profileDir = await createTempDir("agentcompany-agent-handler-");
    const db = new AppDatabase(profileDir);
    db.init();

    db.updateConnectorHealth({
      id: "openai-codex",
      status: "ready",
      authState: "authenticated",
      version: "test",
      lastError: null,
    });
    const companyId = db.saveCompany({
      name: "Handler Test Co",
      description: "Tests saveAgent model validation",
      status: "active",
    });
    db.setDisabledModels(companyId, "openai-codex", [{ id: "gpt-5.4", label: "gpt-5.4" }]);
    const workspaceId = db.saveWorkspace({
      companyId,
      name: "Primary",
      localPath: profileDir,
      repoUrl: "",
      repoRef: "",
      isPrimary: true,
    });
    const agentId = db.saveAgent({
      companyId,
      name: "CEO",
      role: "CEO",
      title: "Chief Executive Officer",
      status: "idle",
      reportsTo: null,
      connectorId: "openai-codex",
      workspaceId,
      model: null,
      capabilities: "Lead the company",
      budgetMonthlyUsd: 250,
    });

    const handlers = new Map<string, IpcHandler>();
    registerCoreAgentGraphHandlers({
      registerHandle: (channel, handler) => {
        handlers.set(channel, handler);
      },
      db,
      ensureCompanyExists: (id) => (db.hasCompany(id) ? null : { ok: false, error: { code: "COMPANY_NOT_FOUND", message: "missing" } }),
      findInvalidReference: () => null,
      publishDomainChanged: vi.fn(),
      handleApprovalResolved: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const saveAgent = handlers.get(IPC_CHANNELS.saveAgent);
    if (!saveAgent) {
      throw new Error("saveAgent handler was not registered.");
    }

    const result = await saveAgent(null as unknown as IpcMainInvokeEvent, {
      id: agentId,
      companyId,
      name: "CEO",
      role: "CEO",
      title: "Chief Executive Officer",
      department: "executive",
      status: "idle",
      reportsTo: null,
      connectorId: "openai-codex",
      workspaceId,
      model: "gpt-5.4",
      metadataJson: "{}",
      capabilities: "Lead the company",
      budgetMonthlyUsd: 250,
    }) as { ok: boolean; error?: { code: string; message: string } };

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("CONNECTOR_MODEL_NOT_ALLOWED");
  });
});
