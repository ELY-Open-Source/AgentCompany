import { app } from "electron";

interface AppLifecycleDependencies {
  getMainWindow: () => Electron.BrowserWindow | null;
  ensureWindow: () => Promise<Electron.BrowserWindow | null>;
  shouldQuit: () => boolean;
  onBeforeQuit: () => void;
}

export function createAppLifecycleService({
  getMainWindow,
  ensureWindow,
  shouldQuit,
  onBeforeQuit,
}: AppLifecycleDependencies) {
  function register(hasSingleInstanceLock: boolean) {
    app.on("activate", async () => {
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (!mainWindow.isVisible()) {
          mainWindow.show();
        }
        mainWindow.focus();
        return;
      }
      await ensureWindow();
    });

    app.on("second-instance", () => {
      if (!hasSingleInstanceLock) {
        return;
      }
      const mainWindow = getMainWindow();
      if (!mainWindow) {
        return;
      }
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    });

    app.on("window-all-closed", () => {
      // macOS keeps the app alive when all windows close (standard platform behavior),
      // except after the user picked Quit (before-quit already fired -> shouldQuit()).
      if (process.platform === "darwin" && !shouldQuit()) {
        return;
      }
      app.quit();
    });

    app.on("before-quit", () => {
      onBeforeQuit();
    });
  }

  return {
    register,
  };
}
