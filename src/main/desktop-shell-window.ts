import { existsSync } from "node:fs";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import { resolve, sep } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  nativeImage,
  nativeTheme,
  net,
  protocol,
  session,
  shell,
} from "electron";
import log from "electron-log/main.js";
import { attachWindowStatePersistence, loadWindowState } from "./window-state";
import type { NotificationOptions } from "./notification-service";
import { classifyExternalUrl } from "./external-url-policy";

export interface DesktopShellWindowDependencies {
  preloadPath: string;
  rendererDist: string;
  iconPath: string;
  isDev: boolean;
  devServerUrl?: string;
  windowStatePath: string;
  shouldQuit: () => boolean;
  onRequestQuit: () => void;
  onCheckForUpdates: () => Promise<void>;
  onBackupProfile: () => Promise<void>;
  onShortcut: (action: "toggle-command-palette" | "refresh") => void;
  notify: (options: NotificationOptions) => void;
  getActiveRunCount: () => number;
}

function isSocialBrowserSession(contents: Electron.WebContents) {
  return contents.session !== session.defaultSession;
}

function isWithinDirectory(rootPath: string, targetPath: string) {
  const normalizedRoot = resolve(rootPath);
  const normalizedTarget = resolve(targetPath);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${sep}`);
}

export function createDesktopShellWindow(deps: DesktopShellWindowDependencies) {
  const {
    preloadPath,
    rendererDist,
    iconPath,
    isDev,
    devServerUrl,
    windowStatePath,
    shouldQuit,
    onRequestQuit,
    notify,
    getActiveRunCount,
  } = deps;

  let mainWindow: BrowserWindow | null = null;
  let backgroundCloseNoticeShown = false;
  let windowCreationPromise: Promise<BrowserWindow | null> | null = null;
  let quitDialogShowing = false;

  /**
   * Quit confirmation gate — shown when agents are actively running.
   * Gives the user three choices:
   *   0 = "Stop All & Quit"  → terminate all agents and exit
   *   1 = "Minimize to Background" → hide window, agents keep running
   *   2 = "Cancel" → do nothing
   *
   * When no agents are active the app quits immediately without a dialog.
   */
  async function requestQuitWithConfirmation() {
    if (quitDialogShowing) return;

    let activeRunCount = 0;
    try {
      activeRunCount = getActiveRunCount();
    } catch (err) {
      log.warn(`[desktop-shell-window] getActiveRunCount failed; quitting as fail-safe:`, err instanceof Error ? err.message : String(err));
      onRequestQuit();
      app.quit();
      return;
    }

    if (activeRunCount === 0) {
      onRequestQuit();
      app.quit();
      return;
    }

    quitDialogShowing = true;
    try {
      const message = activeRunCount === 1
        ? "1 agent run is currently active."
        : `${activeRunCount} agent runs are currently active.`;

      const options: Electron.MessageBoxOptions = {
        type: "question",
        buttons: ["Stop All & Quit", "Minimize to Background", "Cancel"],
        defaultId: 2,
        cancelId: 2,
        title: "AgentCompany",
        message,
        detail: "Quitting will stop all running agents and their tasks. You can also minimize to keep agents running in the background.",
      };

      const parentWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
      const result = parentWindow
        ? await dialog.showMessageBox(parentWindow, options)
        : await dialog.showMessageBox(options);

      if (result.response === 0) {
        // Stop All & Quit
        onRequestQuit();
        app.quit();
      } else if (result.response === 1) {
        // Minimize to Background
        if (parentWindow) {
          parentWindow.hide();
        }
        if (!backgroundCloseNoticeShown) {
          backgroundCloseNoticeShown = true;
          notify({
            title: "Running in Background",
            body: "AgentCompany is still running in the system tray",
            urgency: "informational",
            navigation: { section: "overview" },
          });
        }
      }
      // Cancel: do nothing
    } catch (err) {
      log.warn(`[desktop-shell-window] Quit confirmation dialog failed; quitting as fail-safe:`, err instanceof Error ? err.message : String(err));
      onRequestQuit();
      app.quit();
    } finally {
      quitDialogShowing = false;
    }
  }

  function getMainWindow() {
    return mainWindow;
  }

  function installSecurityGuards() {
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
    app.on("web-contents-created", (_event, contents) => {
      contents.setWindowOpenHandler(({ url }) => {
        const decision = classifyExternalUrl(url);
        if (decision.kind === "trusted") {
          void shell.openExternal(decision.url);
          return { action: "deny" };
        }
        if (decision.kind === "confirm") {
          // Dialog is dispatched asynchronously so the main-process event loop
          // is not blocked while the user decides. setWindowOpenHandler must
          // return synchronously, so the window is always denied here; if the
          // user approves, shell.openExternal runs in the async continuation.
          void (async () => {
            const parentWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
            const options: Electron.MessageBoxOptions = {
              type: "question",
              buttons: ["Open Link", "Cancel"],
              defaultId: 1,
              cancelId: 1,
              title: "Open External Link?",
              message: "AgentCompany blocked an untrusted external link.",
              detail: `${decision.url}\n\nOnly trusted product and documentation domains open automatically. Review this destination before continuing.`,
            };
            const result = parentWindow
              ? await dialog.showMessageBox(parentWindow, options)
              : await dialog.showMessageBox(options);
            if (result.response === 0) {
              void shell.openExternal(decision.url);
            }
          })();
        }
        return { action: "deny" };
      });
      contents.on("will-attach-webview", (event) => {
        event.preventDefault();
      });
      contents.on("will-navigate", (event) => {
        if (isSocialBrowserSession(contents)) return;
        event.preventDefault();
      });
    });
  }

  function registerProtocol() {
    const textMimeTypes: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".mjs": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml; charset=utf-8",
    };
    protocol.handle("app", async (request) => {
      const url = new URL(request.url);
      const relativePath = decodeURIComponent(url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, ""));
      const targetPath = resolve(rendererDist, relativePath);
      if (!isWithinDirectory(rendererDist, targetPath) || !existsSync(targetPath)) {
        return new Response("Not found", { status: 404 });
      }
      const response = await net.fetch(pathToFileURL(targetPath).toString());
      const mime = textMimeTypes[extname(targetPath).toLowerCase()];
      if (mime) {
        const headers = new Headers(response.headers);
        headers.set("Content-Type", mime);
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }
      return response;
    });
  }

  async function createWindow() {
    const windowIcon = nativeImage.createFromPath(iconPath);
    const savedWindowState = loadWindowState(windowStatePath);
    const isWindows = process.platform === "win32";
    const isLinux = process.platform === "linux";
    const webPreferences: Electron.WebPreferences = {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      devTools: isDev,
      webSecurity: true,
      allowRunningInsecureContent: false,
    };
    mainWindow = new BrowserWindow({
      title: "AgentCompany",
      icon: windowIcon.isEmpty() ? undefined : windowIcon,
      width: savedWindowState.bounds.width,
      height: savedWindowState.bounds.height,
      x: savedWindowState.bounds.x,
      y: savedWindowState.bounds.y,
      minWidth: 1180,
      minHeight: 760,
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#141413" : "#F5F4ED",
      frame: process.platform === "darwin",
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
      ...(isWindows || isLinux ? { titleBarOverlay: false } : {}),
      webPreferences,
    });

    if (isDev && devServerUrl) {
      await mainWindow.loadURL(devServerUrl);
    } else {
      await mainWindow.loadURL("app://-/index.html");
    }
    attachWindowStatePersistence(mainWindow, windowStatePath);
    if (savedWindowState.maximized) {
      mainWindow.maximize();
    }
    mainWindow.on("close", (event) => {
      if (process.platform === "darwin" || shouldQuit()) {
        return;
      }
      event.preventDefault();
      mainWindow?.hide();
      if (!backgroundCloseNoticeShown) {
        backgroundCloseNoticeShown = true;
        notify({
          title: "Running in Background",
          body: "AgentCompany is still running in the system tray",
          urgency: "informational",
          navigation: { section: "overview" },
        });
      }
    });
    mainWindow.on("closed", () => {
      mainWindow = null;
    });
  }

  async function ensureWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) {
      if (!windowCreationPromise) {
        windowCreationPromise = createWindow()
          .then(() => mainWindow)
          .finally(() => {
            windowCreationPromise = null;
          });
      }
      return windowCreationPromise;
    }
    return mainWindow;
  }

  return {
    getMainWindow,
    installSecurityGuards,
    registerProtocol,
    createWindow,
    ensureWindow,
    requestQuitWithConfirmation,
  };
}
