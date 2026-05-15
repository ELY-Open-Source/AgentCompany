import type { IpcMainInvokeEvent } from "electron";
import { describe, expect, it, vi } from "vitest";
import type { DesktopResult } from "@shared/contracts";
import { IPC_CHANNELS } from "@shared/contracts";
import type { AppDatabase } from "../../src/main/database";
import { registerCoreReadHandlers } from "../../src/main/ipc-core-read-handlers";
import type { RegisterCoreHandlersDependencies } from "../../src/main/ipc-core-common";

vi.mock("electron", () => ({
  dialog: {
    showMessageBox: vi.fn(),
    showOpenDialog: vi.fn(),
  },
  nativeTheme: { themeSource: "system" },
  shell: {
    openExternal: vi.fn(),
    openPath: vi.fn(),
  },
}));

type IpcHandler = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => Promise<DesktopResult<unknown>> | DesktopResult<unknown>;

const companyId = "11111111-1111-4111-8111-111111111111";

function createReadHandlerHarness(ensureCompanyExists: RegisterCoreHandlersDependencies["ensureCompanyExists"]) {
  const handlers = new Map<string, IpcHandler>();
  const getDisabledModels = vi.fn(() => [{ id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" }]);
  const db = {
    core: {
      settings: {
        getCurrentCompanyId: vi.fn(() => companyId),
        getDisabledModels,
      },
    },
    projection: {
      snapshot: {
        listRendererSnapshot: vi.fn(() => ({})),
      },
    },
  } as unknown as AppDatabase;

  registerCoreReadHandlers({
    registerHandle: (channel, handler) => {
      handlers.set(channel, handler);
    },
    db,
    ensureCompanyExists,
    publishDomainChanged: vi.fn(),
    checkForUpdates: vi.fn(async () => true),
    resetAfterRestore: vi.fn(),
    listConnectorModels: vi.fn(async () => []),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });

  const handler = handlers.get(IPC_CHANNELS.getConnectorDisabledModels);
  if (!handler) {
    throw new Error("getConnectorDisabledModels handler was not registered.");
  }
  return { handler, getDisabledModels };
}

describe("ipc-core-read-handlers connector model pool reads", () => {
  it("reads disabled models after confirming the company exists", async () => {
    const ensureCompanyExists = vi.fn(() => null);
    const { handler, getDisabledModels } = createReadHandlerHarness(ensureCompanyExists);

    const result = await handler(null as unknown as IpcMainInvokeEvent, {
      companyId,
      connectorId: "anthropic",
    });

    expect(result).toEqual({
      ok: true,
      data: [{ id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" }],
    });
    expect(ensureCompanyExists).toHaveBeenCalledWith(companyId);
    expect(getDisabledModels).toHaveBeenCalledWith(companyId, "anthropic");
  });

  it("returns the company boundary error before reading disabled models", async () => {
    const companyError = {
      ok: false,
      error: { code: "COMPANY_NOT_FOUND", message: "Company not found." },
    } satisfies DesktopResult<never>;
    const ensureCompanyExists = vi.fn(() => companyError);
    const { handler, getDisabledModels } = createReadHandlerHarness(ensureCompanyExists);

    const result = await handler(null as unknown as IpcMainInvokeEvent, {
      companyId,
      connectorId: "anthropic",
    });

    expect(result).toEqual(companyError);
    expect(ensureCompanyExists).toHaveBeenCalledWith(companyId);
    expect(getDisabledModels).not.toHaveBeenCalled();
  });
});
