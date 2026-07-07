import { app } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { DatabaseConnection } from "./database/connection";
import { createMainWindow } from "./app/create-window";
import { registerIpcHandlers } from "./app/ipc-handlers";
import { syncSkillsFromDisk } from "./services/skill-discovery";
import { SkillService } from "./services/skill-service";
import { startProviderBackgroundWorker } from "./app/provider-background-worker";
import { recoverInterruptedWork } from "./app/startup-recovery";
import { startTaskQueueWorker } from "./app/task-queue-worker";

const __dirname = dirname(fileURLToPath(import.meta.url));

// A losing second instance must never touch the database: quit is
// asynchronous, so all startup work stays behind the lock check.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    const profileDir = process.env.AGENTCOMPANY_NEW_PROFILE_DIR ?? join(app.getPath("userData"), "profile");
    const connection = new DatabaseConnection(join(profileDir, "agentcompany.db"));
    connection.transaction(() => recoverInterruptedWork(connection.db));
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
    syncAllOrganizationSkills(connection.db, join(profileDir, "artifacts"));
    const stopProviderBackgroundWorker = startProviderBackgroundWorker({
      db: connection.db,
      mainWindow: win,
    });
    const autonomousExecution = process.env.AGENTCOMPANY_NEW_AUTORUN !== "0";
    const stopTaskQueueWorker = autonomousExecution
      ? startTaskQueueWorker({ connection, mainWindow: win })
      : () => {};

    app.on("second-instance", () => {
      if (win.isMinimized()) win.restore();
      win.focus();
    });

    app.on("before-quit", () => {
      stopProviderBackgroundWorker();
      stopTaskQueueWorker();
      connection.close();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

/**
 * Loads the on-disk skill library for every organization at startup. One
 * organization's failure (a broken workspace path, say) must not block the
 * rest — or the app.
 */
function syncAllOrganizationSkills(db: DatabaseSync, artifactRoot: string): void {
  const skills = new SkillService(db, artifactRoot);
  const orgs = db.prepare("select id from organizations").all() as Array<{ id: string }>;
  for (const org of orgs) {
    try {
      syncSkillsFromDisk(db, skills, org.id);
    } catch {
      // Broken directories are reported per entry inside the sync; anything
      // beyond that is a per-org environment fault that must not stop startup.
    }
  }
}
