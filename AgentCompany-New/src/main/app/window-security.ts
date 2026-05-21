import type { BrowserWindow } from "electron";

export function attachMainWindowSecurity(win: BrowserWindow, devServerOrigin: string | null): void {
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (devServerOrigin && url.startsWith(devServerOrigin)) return;
    if (url.startsWith("file://")) return;
    event.preventDefault();
  });
}
