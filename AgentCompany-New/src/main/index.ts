import { app } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseConnection } from "./database/connection";
import { createMainWindow } from "./app/create-window";
import { registerIpcHandlers } from "./app/ipc-handlers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

app.whenReady().then(() => {
  const profileDir = process.env.AGENTCOMPANY_NEW_PROFILE_DIR ?? join(app.getPath("userData"), "profile");
  const connection = new DatabaseConnection(join(profileDir, "agentcompany.db"));
  const win = createMainWindow({
    preloadPath: join(__dirname, "../preload/index.js"),
    rendererDist: join(__dirname, "../renderer"),
    devServerUrl: process.env.ELECTRON_RENDERER_URL,
  });

  registerIpcHandlers({
    connection,
    mainWindow: win,
    artifactRoot: join(profileDir, "artifacts"),
  });

  app.on("second-instance", () => {
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.on("before-quit", () => {
    connection.close();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
