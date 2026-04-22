import type { IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopResult } from "@shared/contracts";

const { ipcHandlers, ipcHandle } = vi.hoisted(() => {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<DesktopResult<unknown>>>();
  return {
    ipcHandlers: handlers,
    ipcHandle: vi.fn((channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<DesktopResult<unknown>>) => {
      handlers.set(channel, handler);
    }),
  };
});

vi.mock("electron", () => ({
  ipcMain: {
    handle: ipcHandle,
  },
  Notification: {
    isSupported: () => false,
  },
}));

import { createIpcSupport } from "../../src/main/ipc-support";

describe("IPC support error codes", () => {
  beforeEach(() => {
    ipcHandlers.clear();
    ipcHandle.mockClear();
  });

  it("returns the classified handler code without leaking the raw exception message", async () => {
    const { registerHandle } = createSupport();
    registerHandle("test:throws", () => {
      throw new Error("database password leaked in raw error");
    });

    const result = await invokeRegisteredHandler("test:throws");

    expect(result).toEqual({
      ok: false,
      error: {
        code: "ipc.handler.failed",
        message: "The desktop operation failed. Use the error code when reporting this issue.",
      },
    });
  });

  it("returns the classified payload code for zod validation failures", async () => {
    const { registerHandle } = createSupport();
    registerHandle("test:payload", () => {
      z.object({ name: z.string() }).parse({ name: 42 });
      return { ok: true, data: true };
    });

    const result = await invokeRegisteredHandler("test:payload");

    expect(result).toEqual({
      ok: false,
      error: {
        code: "ipc.payload.invalid",
        message: "The desktop request payload is invalid.",
      },
    });
  });
});

function createSupport() {
  return createIpcSupport({
    isDev: true,
    devServerOrigin: "http://localhost:5173",
    logger: { error: vi.fn() },
    getMainWindow: () => null,
    getDb: () => ({
      hasCompany: () => true,
      belongsToCompany: () => true,
    }),
  });
}

async function invokeRegisteredHandler(channel: string): Promise<DesktopResult<unknown>> {
  const handler = ipcHandlers.get(channel);
  if (!handler) throw new Error(`No IPC handler registered for ${channel}.`);
  return handler({
    senderFrame: { url: "http://localhost:5173/app" },
    sender: { getURL: () => "http://localhost:5173/app" },
  } as IpcMainInvokeEvent);
}
