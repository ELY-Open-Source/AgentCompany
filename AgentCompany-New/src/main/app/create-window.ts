import { BrowserWindow } from "electron";
import { join } from "node:path";
import { attachMainWindowSecurity } from "./window-security";

export interface CreateWindowOptions {
  preloadPath: string;
  rendererDist: string;
  devServerUrl?: string;
}

export function createMainWindow(options: CreateWindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 700,
    title: "AgentCompany",
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    webPreferences: {
      preload: options.preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  attachMainWindowSecurity(
    win,
    options.devServerUrl ? new URL(options.devServerUrl).origin : null,
  );
  win.once("ready-to-show", () => win.show());

  if (options.devServerUrl) {
    win.loadURL(options.devServerUrl);
  } else {
    win.loadFile(join(options.rendererDist, "index.html"));
  }

  return win;
}
