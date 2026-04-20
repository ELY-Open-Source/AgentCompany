import type { IpcMainInvokeEvent, BrowserWindow } from "electron";
import { ipcMain, Notification } from "electron";
import { ZodError } from "zod";
import type { DesktopEvent } from "@shared/types";
import type { DesktopResult } from "@shared/contracts";
import type { NotificationOptions } from "./notification-service";

interface IpcSupportDependencies {
  isDev: boolean;
  devServerOrigin: string | null;
  logger: {
    error: (...args: unknown[]) => void;
  };
  getMainWindow: () => BrowserWindow | null;
  getDb: () => {
    hasCompany: (companyId: string) => boolean;
    belongsToCompany: (table: string, id: string, companyId: string) => boolean;
  };
  notificationService?: { notify: (options: NotificationOptions) => void };
}

function isTrustedRendererUrl(url: string, isDev: boolean, devServerOrigin: string | null) {
  if (!url) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (isDev) {
    return devServerOrigin ? parsed.origin === devServerOrigin : false;
  }
  return parsed.protocol === "app:" && parsed.hostname === "-";
}

export function createIpcSupport({
  isDev,
  devServerOrigin,
  logger,
  getMainWindow,
  getDb,
  notificationService,
}: IpcSupportDependencies) {
  function sanitizeHandlerError(error: unknown) {
    if (error instanceof ZodError) {
      return {
        code: "IPC_INVALID_PAYLOAD",
        message: "The desktop request payload is invalid.",
      };
    }
    return {
      code: "IPC_HANDLER_FAILED",
      message: "The desktop operation failed. Review the application logs for details.",
    };
  }

  function fail(code: string, message: string): DesktopResult<never> {
    return { ok: false, error: { code, message } };
  }

  function registerHandle(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<DesktopResult<unknown>> | DesktopResult<unknown>,
  ) {
    ipcMain.handle(channel, async (event, ...args) => {
      const senderUrl = event.senderFrame?.url ?? event.sender.getURL();
      if (!isTrustedRendererUrl(senderUrl, isDev, devServerOrigin)) {
        logger.error(`[ipc:${channel}] blocked untrusted sender ${senderUrl || "<empty>"}`);
        return fail("IPC_FORBIDDEN", "IPC sender is not allowed.");
      }
      try {
        return await handler(event, ...args);
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : String(error);
        const sanitized = sanitizeHandlerError(error);
        logger.error(`[ipc:${channel}] ${rawMessage}`);
        return fail(sanitized.code, sanitized.message);
      }
    });
  }

  // Transport-layer failures when the renderer is mid-reload or already
  // disposed throw "Render frame was disposed before WebFrameMain could
  // be accessed" out of Electron's IPC core. Those exceptions are a
  // lifecycle signal, never a logic bug — but if they bubble, they
  // abort every downstream event in the same tick (RuntimeBridge fans
  // two emits per agent-event, the second one never runs when the first
  // throws). Treat emitEvent as a fire-and-forget sink: renderer
  // disappearances are silent, real serialisation errors are warned
  // once per event type.
  const renderFrameDisposedMessage = "Render frame was disposed";
  const emitWarnedChannels = new Set<string>();

  function emitEvent(event: DesktopEvent) {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const webContents = mainWindow.webContents;
    if (webContents.isDestroyed() || webContents.isCrashed()) return;
    // `mainFrame.detached` flips true while the frame is being torn down
    // or swapped during a navigation. Sending into a detached frame is
    // what makes Electron's native layer throw "Render frame was
    // disposed" and also what makes its own WebFrameMain.prototype.send
    // spam `console.error('Error sending from webFrameMain: ', …)` to
    // stderr on every call. Short-circuiting here closes the window
    // between our `isDestroyed` check and the native send.
    const mainFrame = webContents.mainFrame;
    if (!mainFrame || mainFrame.detached) return;
    try {
      webContents.send("agent-company:event", event);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes(renderFrameDisposedMessage)) {
        // Renderer is reloading or gone — expected; skip.
        return;
      }
      const key = event.type ?? "<untyped>";
      if (!emitWarnedChannels.has(key)) {
        emitWarnedChannels.add(key);
        logger.error(`[ipc] emitEvent(${key}) failed: ${message}`);
      }
    }
  }

  function ensureCompanyExists(companyId: string) {
    return getDb().hasCompany(companyId)
      ? null
      : fail("COMPANY_NOT_FOUND", "The selected company no longer exists.");
  }

  function findInvalidReference(
    companyId: string,
    refs: Array<{ id: string | null | undefined; table: string; label: string }>,
  ) {
    return refs.find((ref) => ref.id && !getDb().belongsToCompany(ref.table, ref.id, companyId)) ?? null;
  }

  function publishDomainChanged() {
    emitEvent({ type: "domain-changed" });
  }

  function notify(options: NotificationOptions) {
    if (notificationService) {
      notificationService.notify(options);
    } else if (Notification.isSupported()) {
      // Fallback for early bootstrap before notification service is wired
      new Notification({ title: options.title, body: options.body }).show();
    }
  }

  return {
    fail,
    registerHandle,
    emitEvent,
    ensureCompanyExists,
    findInvalidReference,
    publishDomainChanged,
    notify,
  };
}
