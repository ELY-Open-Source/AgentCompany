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
      // On macOS, keep the app running when all windows are closed (standard behavior)
      // UNLESS the user explicitly chose Quit (before-quit already fired).
      if (process.platform !== "darwin" || shouldQuit()) {
        app.quit();
      }
    });

    app.on("before-quit", () => {
      onBeforeQuit();
    });
  }

  return {
    register,
  };
}
