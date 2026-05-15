import { describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "../../src/shared/contracts";

const electron = vi.hoisted(() => ({
  openExternal: vi.fn<() => Promise<void>>(async () => {}),
  openPath: vi.fn<() => Promise<string>>(async () => ""),
  showMessageBox: vi.fn<() => Promise<{ response: number }>>(async () => ({ response: 0 })),
}));

vi.mock("electron", () => ({
  dialog: { showMessageBox: electron.showMessageBox },
  nativeTheme: { themeSource: "system" },
  shell: {
    openExternal: electron.openExternal,
    openPath: electron.openPath,
  },
}));

import { registerCoreReadHandlers } from "../../src/main/ipc-core-read-handlers";
import type { AppDatabase } from "../../src/main/database";
import type { RegisterCoreHandlersDependencies } from "../../src/main/ipc-core-common";

const companyId = "11111111-1111-4111-8111-111111111111";
const workProductId = "22222222-2222-4222-8222-222222222222";

function registerOpenWorkProductHandler(url: string) {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown> | unknown>();
  const db = {
    core: {
      documents: {
        resolveWorkProductTarget: vi.fn(() => ({ kind: "url", value: url })),
        updateWorkProduct: vi.fn(),
      },
      settings: {
        canOpenPath: vi.fn(() => true),
        getCurrentCompanyId: vi.fn(() => companyId),
      },
    },
    projection: {
      snapshot: {
        listRendererSnapshot: vi.fn(() => ({})),
      },
    },
  } as unknown as AppDatabase;
  const deps = {
    registerHandle: (channel, handler) => handlers.set(channel, handler as (...args: unknown[]) => Promise<unknown> | unknown),
    db,
    ensureCompanyExists: () => null,
    publishDomainChanged: vi.fn(),
    checkForUpdates: vi.fn(async () => true),
    resetAfterRestore: vi.fn(),
    listConnectorModels: vi.fn(async () => []),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } satisfies Pick<
    RegisterCoreHandlersDependencies,
    | "registerHandle"
    | "db"
    | "ensureCompanyExists"
    | "publishDomainChanged"
    | "checkForUpdates"
    | "resetAfterRestore"
    | "listConnectorModels"
    | "logger"
  >;
  registerCoreReadHandlers(deps);
  const handler = handlers.get(IPC_CHANNELS.openWorkProduct);
  if (!handler) {
    throw new Error("openWorkProduct handler was not registered.");
  }
  return handler;
}

async function openUrl(url: string) {
  const handler = registerOpenWorkProductHandler(url);
  return handler({}, { companyId, id: workProductId });
}

describe("openWorkProduct external URL policy", () => {
  it("opens trusted hosts without confirmation", async () => {
    electron.openExternal.mockClear();
    electron.showMessageBox.mockClear();

    const result = await openUrl("https://github.com/acme/repo");

    expect(result).toEqual({ ok: true, data: true });
    expect(electron.showMessageBox).not.toHaveBeenCalled();
    expect(electron.openExternal).toHaveBeenCalledWith("https://github.com/acme/repo");
  });

  it("asks before opening untrusted http hosts", async () => {
    electron.openExternal.mockClear();
    electron.showMessageBox.mockClear();
    electron.showMessageBox.mockResolvedValueOnce({ response: 0 });

    const result = await openUrl("https://example.com/report");

    expect(result).toEqual({ ok: true, data: true });
    expect(electron.showMessageBox).toHaveBeenCalledTimes(1);
    expect(electron.openExternal).toHaveBeenCalledWith("https://example.com/report");
  });

  it("blocks custom schemes before shell handoff", async () => {
    electron.openExternal.mockClear();
    electron.showMessageBox.mockClear();

    const result = await openUrl("vscode://file/etc/passwd");

    expect(result).toMatchObject({ ok: false, error: { code: "OPEN_EXTERNAL_URL_FORBIDDEN" } });
    expect(electron.showMessageBox).not.toHaveBeenCalled();
    expect(electron.openExternal).not.toHaveBeenCalled();
  });

  it("blocks credential-bearing URLs before shell handoff", async () => {
    electron.openExternal.mockClear();
    electron.showMessageBox.mockClear();

    const result = await openUrl("https://user:pass@example.com/report");

    expect(result).toMatchObject({ ok: false, error: { code: "OPEN_EXTERNAL_URL_FORBIDDEN" } });
    expect(electron.showMessageBox).not.toHaveBeenCalled();
    expect(electron.openExternal).not.toHaveBeenCalled();
  });
});
