import { BrowserWindow } from "electron";
import { join } from "node:path";
import { attachMainWindowSecurity } from "./window-security";

export interface CreateWindowOptions {
  preloadPath: string;
  rendererDist: string;
  devServerUrl?: string;
  /** UI language for renderer strings; injected synchronously via argv. */
  language: string;
}

export function createMainWindow(options: CreateWindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 700,
    title: "AgentCompany",
    // macOS takes the window image from the app bundle; Windows and Linux
    // want it on the window itself (dev runs included).
    ...(process.platform === "darwin" ? {} : { icon: join(__dirname, "../../resources/icon.png") }),
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    webPreferences: {
      preload: options.preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      additionalArguments: [`--app-language=${options.language}`],
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
