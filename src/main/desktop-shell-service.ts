import { existsSync } from "node:fs";
import { extname } from "node:path";
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
  notify: (title: string, body: string) => void;
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
}: DesktopShellDependencies) {
  let mainWindow: BrowserWindow | null = null;
  let appTray: Tray | null = null;
  let backgroundCloseNoticeShown = false;
  let windowCreationPromise: Promise<BrowserWindow | null> | null = null;

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
        notify("AgentCompany is still running", "Automation continues in the background until you quit the app.");
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
        { role: "quit" },
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
          ...(process.platform === "darwin" ? [] : [{ type: "separator" as const }, { role: "quit" as const }]),
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
    if (process.platform === "darwin" || appTray) {
      return;
    }

    const trayIcon = nativeImage.createFromPath(iconPath);
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
          click: () => {
            onRequestQuit();
            app.quit();
          },
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
