import { existsSync } from "node:fs";
import { extname, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolve, sep } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  net,
  protocol,
  session,
  shell,
  Tray,
} from "electron";
import { attachWindowStatePersistence, loadWindowState } from "./window-state";
import type { NotificationOptions } from "./notification-service";

interface DesktopShellDependencies {
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
  onShortcut: (action: "toggle-command-palette" | "toggle-console" | "refresh") => void;
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

export function createDesktopShellService({
  preloadPath,
  rendererDist,
  iconPath,
  isDev,
  devServerUrl,
  windowStatePath,
  shouldQuit,
  onRequestQuit,
  onCheckForUpdates,
  onBackupProfile,
  onShortcut,
  notify,
  getActiveRunCount,
}: DesktopShellDependencies) {
  let mainWindow: BrowserWindow | null = null;
  let appTray: Tray | null = null;
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
    } catch {
      // Cannot determine active runs — proceed with immediate quit as fail-safe
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
    } catch {
      // Dialog failed (e.g. window destroyed mid-flight) — quit as fail-safe
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
      contents.setWindowOpenHandler(() => ({ action: "deny" }));
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
    mainWindow = new BrowserWindow({
      title: "AgentCompany",
      icon: windowIcon.isEmpty() ? undefined : windowIcon,
      width: savedWindowState.bounds.width,
      height: savedWindowState.bounds.height,
      x: savedWindowState.bounds.x,
      y: savedWindowState.bounds.y,
      minWidth: 1180,
      minHeight: 760,
      backgroundColor: "#13110f",
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        devTools: isDev,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
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

  function buildMenu() {
    const macAppMenu: Electron.MenuItemConstructorOptions = {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        {
          label: `Quit ${app.name}`,
          accelerator: "CmdOrCtrl+Q",
          click: () => void requestQuitWithConfirmation(),
        },
      ],
    };
    const template: Electron.MenuItemConstructorOptions[] = [
      ...(process.platform === "darwin" ? [macAppMenu] : []),
      {
        label: "File",
        submenu: [
          {
            label: "Open Workspace Folder",
            accelerator: "CmdOrCtrl+O",
            click: async () => {
              const result = await dialog.showOpenDialog({
                properties: ["openDirectory"],
              });
              if (result.canceled || result.filePaths.length === 0) return;
              shell.openPath(result.filePaths[0] ?? "");
            },
          },
          { type: "separator" },
          {
            label: "Backup Profile",
            accelerator: "CmdOrCtrl+Shift+B",
            click: async () => {
              await onBackupProfile();
            },
          },
          ...(process.platform === "darwin" ? [] : [
            { type: "separator" as const },
            {
              label: "Quit",
              accelerator: "Alt+F4",
              click: () => void requestQuitWithConfirmation(),
            },
          ]),
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "View",
        submenu: [
          {
            label: "Command Palette",
            accelerator: "CmdOrCtrl+K",
            click: () => onShortcut("toggle-command-palette"),
          },
          {
            label: "Toggle Console",
            accelerator: "CmdOrCtrl+`",
            click: () => onShortcut("toggle-console"),
          },
          {
            label: "Refresh Data",
            accelerator: "CmdOrCtrl+R",
            click: () => onShortcut("refresh"),
          },
          { type: "separator" },
          { role: "toggleDevTools", visible: isDev },
        ],
      },
      {
        label: "Run",
        submenu: [
          {
            label: "Check For Updates",
            click: async () => {
              await onCheckForUpdates();
            },
          },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  function createTray() {
    if (appTray) {
      return;
    }

    const assetsDir = dirname(iconPath);
    let trayIcon: Electron.NativeImage;

    if (process.platform === "darwin") {
      // macOS menu bar: use Template images (monochrome black + alpha).
      // Electron auto-detects the @2x variant when the base name includes "Template".
      const templatePath = join(assetsDir, "tray-iconTemplate.png");
      trayIcon = nativeImage.createFromPath(templatePath);
      if (!trayIcon.isEmpty()) {
        trayIcon.setTemplateImage(true);
      }
    } else {
      // Windows / Linux: use the color tray icon
      const trayPath = join(assetsDir, "tray-icon.png");
      trayIcon = nativeImage.createFromPath(trayPath);
    }

    // Fallback: resize the full app icon
    if (trayIcon.isEmpty()) {
      const fallback = nativeImage.createFromPath(iconPath);
      if (!fallback.isEmpty()) {
        trayIcon = fallback.resize({ width: 32, height: 32 });
        if (process.platform === "darwin") {
          trayIcon.setTemplateImage(true);
        }
      }
    }

    appTray = new Tray(trayIcon.isEmpty() ? nativeImage.createEmpty() : trayIcon);
    appTray.setToolTip("AgentCompany");
    appTray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: "Show AgentCompany",
          click: () => {
            void ensureWindow().then((win) => {
              if (win) {
                win.show();
                win.focus();
              }
            });
          },
        },
        {
          label: "Hide AgentCompany",
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.hide();
            }
          },
        },
        { type: "separator" },
        {
          label: "Quit",
          click: () => void requestQuitWithConfirmation(),
        },
      ]),
    );
    appTray.on("click", () => {
      void ensureWindow().then((win) => {
        if (!win) return;
        if (win.isVisible()) {
          win.hide();
          return;
        }
        win.show();
        win.focus();
      });
    });
  }

  function destroy() {
    appTray?.destroy();
    appTray = null;
  }

  function initialize() {
    installSecurityGuards();
    registerProtocol();
    buildMenu();
    createTray();
  }

  return {
    initialize,
    installSecurityGuards,
    registerProtocol,
    buildMenu,
    createTray,
    createWindow,
    ensureWindow,
    getMainWindow,
    destroy,
  };
}
