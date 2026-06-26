import type { BrowserWindow } from "electron";

export function attachMainWindowSecurity(win: BrowserWindow, devServerOrigin: string | null): void {
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const blockNavigation = (event: Electron.Event, url: string): void => {
    if (devServerOrigin && url.startsWith(devServerOrigin)) return;
    if (url.startsWith("file://")) return;
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
