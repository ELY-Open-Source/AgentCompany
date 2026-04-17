import { dirname, join } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
} from "electron";
import { IPC_CHANNELS } from "@shared/contracts";

export interface DesktopShellMenuDependencies {
  iconPath: string;
  isDev: boolean;
  onCheckForUpdates: () => Promise<void>;
  onBackupProfile: () => Promise<void>;
  onShortcut: (action: "toggle-command-palette" | "toggle-console" | "refresh") => void;
  getMainWindow: () => BrowserWindow | null;
  ensureWindow: () => Promise<BrowserWindow | null>;
  requestQuitWithConfirmation: () => Promise<void>;
}

export function createDesktopShellMenu(deps: DesktopShellMenuDependencies) {
  const {
    iconPath,
    isDev,
    onCheckForUpdates,
    onBackupProfile,
    onShortcut,
    getMainWindow,
    ensureWindow,
    requestQuitWithConfirmation,
  } = deps;

  let appTray: Tray | null = null;

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
              const targetPath = result.filePaths[0];
              if (result.canceled || !targetPath) return;
              shell.openPath(targetPath);
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
    const menu = Menu.buildFromTemplate(template);
    const mainWindow = getMainWindow();
    if (process.platform === "darwin") {
      Menu.setApplicationMenu(menu);
    } else {
      // Frameless windows: hide native menu bar but keep keyboard accelerators active
      Menu.setApplicationMenu(menu);
      mainWindow?.setMenuBarVisibility(false);
      mainWindow?.setAutoHideMenuBar(true);
    }
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
            const mainWindow = getMainWindow();
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

  function registerWindowControlIpc() {
    // Window control IPC for custom title bar (Windows/Linux frameless windows)
    ipcMain.handle(IPC_CHANNELS.windowMinimize, () => { getMainWindow()?.minimize(); });
    ipcMain.handle(IPC_CHANNELS.windowMaximize, () => {
      const mainWindow = getMainWindow();
      if (mainWindow?.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow?.maximize();
      }
    });
    ipcMain.handle(IPC_CHANNELS.windowClose, () => { getMainWindow()?.close(); });
    ipcMain.handle(IPC_CHANNELS.windowIsMaximized, () => getMainWindow()?.isMaximized() ?? false);
  }

  function destroy() {
    appTray?.destroy();
    appTray = null;
  }

  return {
    buildMenu,
    createTray,
    registerWindowControlIpc,
    destroy,
  };
}
