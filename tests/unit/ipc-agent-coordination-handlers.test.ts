import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import type { DesktopResult } from "@shared/contracts";
import { IPC_CHANNELS } from "@shared/contracts";
import { AppDatabase } from "../../src/main/database";
import { registerAgentCoordinationHandlers } from "../../src/main/ipc-agent-coordination-handlers";
import { HUMAN_SENDER_ID } from "../../src/main/messaging/dispatch";

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

function createScaffold(db: AppDatabase) {
  db.core.connectors.updateConnectorHealth({
    id: "openai-codex",
    status: "ready",
    authState: "authenticated",
    version: "test",
    lastError: null,
  });
  const companyId = db.core.company.saveCompany({
    name: "IPC Message Co",
    description: "Tests desktop message routing",
    status: "active",
  });
  const workspaceId = db.core.workspaces.saveWorkspace({
    companyId,
    name: "Primary",
    localPath: "/tmp/ipc-message",
    repoUrl: "",
    repoRef: "",
    isPrimary: true,
  });
  const agentId = db.core.agents.saveAgent({
    companyId,
    name: "Engineer",
    role: "Engineer",
    title: "Lead Engineer",
    status: "idle",
    reportsTo: null,
    connectorId: "openai-codex",
    workspaceId,
    model: null,
    capabilities: "Ship features",
    budgetMonthlyUsd: 180,
  });
  return { companyId, agentId };
}

describe("ipc agent coordination handlers", () => {
  it("routes desktop messages into a recipient's live runtime before falling back to wake", async () => {
    const profileDir = await createTempDir("agentcompany-ipc-message-");
    const db = new AppDatabase(profileDir);
    db.init();

    const { companyId, agentId } = createScaffold(db);
    const handlers = new Map<string, IpcHandler>();
    const injectRuntimeMessage = vi.fn().mockReturnValue(true);
    const wakeAgentIfPossible = vi.fn().mockReturnValue("queued-run");
    const dependencies = {
      registerHandle: (channel: string, handler: IpcHandler) => {
        handlers.set(channel, handler);
      },
      db,
      ensureCompanyExists: () => null,
      publishDomainChanged: vi.fn(),
      emitEvent: vi.fn(),
      notify: vi.fn(),
      wakeAgentIfPossible,
      injectRuntimeMessage,
      onHumanMessage: vi.fn(),
    };

    registerAgentCoordinationHandlers(dependencies);
    const sendAgentMessage = handlers.get(IPC_CHANNELS.sendAgentMessage);
    if (!sendAgentMessage) {
      throw new Error("sendAgentMessage handler was not registered.");
    }

    const result = await sendAgentMessage(null as unknown as IpcMainInvokeEvent, {
      companyId,
      fromAgentId: HUMAN_SENDER_ID,
      toAgentId: agentId,
      channel: "direct",
      subject: "live steer",
      body: "Please use this new context now.",
      priority: "normal",
    });

    expect(result.ok).toBe(true);
    expect(injectRuntimeMessage).toHaveBeenCalledTimes(1);
    expect(injectRuntimeMessage).toHaveBeenCalledWith(agentId, companyId, expect.objectContaining({
      body: "Please use this new context now.",
    }));
    expect(wakeAgentIfPossible).not.toHaveBeenCalled();

    db.close();
  });
});
