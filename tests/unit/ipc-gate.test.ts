import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test, vi } from "vitest";

const registered = new Map<string, (event: unknown, raw: unknown) => unknown>();
vi.mock("electron", () => ({
  ipcMain: { handle: (channel: string, listener: (event: unknown, raw: unknown) => unknown) => registered.set(channel, listener) },
}));

const { createIpcGate } = await import("../../src/main/app/ipc-gate");
const { IPC_CHANNELS } = await import("../../src/shared/ipc");

const mainWindow = { webContents: { id: 1 } } as unknown as Electron.BrowserWindow;
const appPage = pathToFileURL(join(tmpdir(), "app", "index.html")).href;
const fromApp = { sender: { id: 1 }, senderFrame: { parent: null, url: `${appPage}#/work` } };

describe("the IPC gate", () => {
  test("only the app's own page reaches a service, and only with input that matches the call's contract", () => {
    const handle = createIpcGate(mainWindow, appPage);
    const devHandle = createIpcGate(mainWindow, "http://localhost:5173/");
    const run = vi.fn((input: unknown) => ({ ok: true, data: input }));
    handle("stopRun", run);
    const call = (event: unknown, raw: unknown) => registered.get(IPC_CHANNELS.stopRun)!(event, raw);

    expect(call({ ...fromApp, sender: { id: 2 } }, { runId: "run_1" })).toMatchObject({ ok: false, error: { code: "forbidden_sender" } });
    expect(call({ ...fromApp, senderFrame: { parent: {}, url: "file:///C:/app/index.html" } }, { runId: "run_1" })).toMatchObject({ ok: false, error: { code: "forbidden_sender" } });
    expect(call({ ...fromApp, senderFrame: { parent: null, url: "https://evil.example/" } }, { runId: "run_1" })).toMatchObject({ ok: false, error: { code: "forbidden_sender" } });
    // Another local page is not the app's own, even though it is a file too.
    const untrusted = pathToFileURL(join(tmpdir(), "Downloads", "untrusted.html")).href;
    expect(call({ ...fromApp, senderFrame: { parent: null, url: untrusted } }, { runId: "run_1" })).toMatchObject({ ok: false, error: { code: "forbidden_sender" } });
    expect(call(fromApp, { runId: 7 })).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(call(fromApp, { runId: "run_1", extra: true })).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(run).not.toHaveBeenCalled();

    expect(call(fromApp, { runId: "run_1" })).toEqual({ ok: true, data: { runId: "run_1" } });
    expect(run).toHaveBeenCalledTimes(1);
    // In development the dev server's origin is the app's page.
    devHandle("stopRun", run);
    expect(call({ ...fromApp, senderFrame: { parent: null, url: "http://localhost:5173/#/work" } }, { runId: "run_2" })).toEqual({ ok: true, data: { runId: "run_2" } });
    expect(call({ ...fromApp, senderFrame: { parent: null, url: appPage } }, { runId: "run_3" })).toMatchObject({ ok: false, error: { code: "forbidden_sender" } });
  });
});
