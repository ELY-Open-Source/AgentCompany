import type { BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";

/** Whether a URL is the app's own page: the exact index.html it was built with, or any route of the dev server it is served by. */
export function isAppPage(url: string, appPage: string): boolean {
  if (!URL.canParse(url)) return false;
  const target = new URL(url);
  const page = new URL(appPage);
  if (page.protocol !== "file:") return target.origin === page.origin;
  if (target.protocol !== "file:") return false;
  const path = (value: URL): string => (process.platform === "win32" ? fileURLToPath(value).toLowerCase() : fileURLToPath(value));
  return path(target) === path(page);
}

export function attachMainWindowSecurity(win: BrowserWindow, appPage: string): void {
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const blockNavigation = (event: Electron.Event, url: string): void => {
    if (isAppPage(url, appPage)) return;
    event.preventDefault();
  };
  win.webContents.on("will-navigate", blockNavigation);
  win.webContents.on("will-redirect", blockNavigation);
  // The first-party renderer never asks for camera, microphone, geolocation,
  // notifications, and the like, so deny every permission outright — matching
  // the provider sign-in windows — rather than leaving the default allow.
  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  win.webContents.session.setPermissionCheckHandler(() => false);
}
