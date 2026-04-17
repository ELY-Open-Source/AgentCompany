import { app } from "electron";

interface AppLifecycleDependencies {
  getMainWindow: () => Electron.BrowserWindow | null;
  ensureWindow: () => Promise<Electron.BrowserWindow | null>;
  shouldQuit: () => boolean;
  /**
   * Invoked on the Electron `before-quit` event. The lifecycle service will
   * call `event.preventDefault()` on the first invocation so the owner of
   * this hook can perform an awaited drain and then invoke `app.exit()`
   * explicitly when the drain resolves. Subsequent `before-quit` events are
   * ignored because the drain is already in flight.
   */
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

    let drainStarted = false;
    app.on("before-quit", (event) => {
      if (drainStarted) return;
      drainStarted = true;
      // Block Electron's default quit until the owner's drain resolves. The
      // owner must call app.exit() itself when drain is complete.
      event.preventDefault();
      onBeforeQuit();
    });
  }

  return {
    register,
  };
}
