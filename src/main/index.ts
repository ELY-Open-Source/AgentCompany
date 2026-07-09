import { app } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { DatabaseConnection } from "./database/connection";
import { createMainWindow } from "./app/create-window";
import { registerIpcHandlers } from "./app/ipc-handlers";
import { builtinSkillsSourceOverride, importStagedSkills, stageBuiltinSkillsLibrary } from "./services/builtin-skills";
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
  const profileDir = process.env.AGENTCOMPANY_NEW_PROFILE_DIR ?? join(app.getPath("userData"), "profile");
  // The database opens before ready: Chromium's UI locale (form-control
  // strings, date formatting) is only settable pre-ready, and it follows the
  // stored language preference instead of the OS locale.
  const connection = new DatabaseConnection(join(profileDir, "agentcompany.db"));
  const language = storedLanguage(connection.db);
  app.commandLine.appendSwitch("lang", language === "zh" ? "zh-CN" : "en-US");

  app.whenReady().then(() => {
    connection.transaction(() => recoverInterruptedWork(connection.db));
    const win = createMainWindow({
      preloadPath: join(__dirname, "../preload/index.js"),
      rendererDist: join(__dirname, "../renderer"),
      devServerUrl: process.env.ELECTRON_RENDERER_URL,
      language,
    });

    const builtinSkillsSource = resolveBuiltinSkillsSource();
    const builtinSkillsLibrary = join(profileDir, "builtin-skills");
    registerIpcHandlers({
      connection,
      mainWindow: win,
      artifactRoot: join(profileDir, "artifacts"),
      builtinSkillsSource,
      builtinSkillsLibrary,
    });
    syncAllOrganizationSkills(connection, join(profileDir, "artifacts"), builtinSkillsSource, builtinSkillsLibrary);
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

function storedLanguage(db: DatabaseSync): string {
  const row = db.prepare("select language from app_state where id = 1").get() as { language: string } | undefined;
  return row?.language ?? "en";
}

/**
 * The bundled skill catalogue: the repo folder during development, the
 * extraResources copy in a packaged build, or an explicit override for
 * hermetic tests (same seam pattern as AGENTCOMPANY_NEW_PROFILE_DIR).
 */
function resolveBuiltinSkillsSource(): string {
  const override = builtinSkillsSourceOverride();
  if (override) return override;
  if (app.isPackaged) return join(process.resourcesPath, "built-in-skills");
  return join(app.getAppPath(), "built-in skills");
}

/**
 * Mirrors the bundled skill catalogue into the profile library and imports it
 * for every organization at startup. Per-skill failures are reported inside
 * the sync; a broken bundle is loud in the log but must not stop the app.
 */
function syncAllOrganizationSkills(connection: DatabaseConnection, artifactRoot: string, sourceRoot: string, libraryRoot: string): void {
  try {
    const staged = stageBuiltinSkillsLibrary(sourceRoot, libraryRoot);
    const skills = new SkillService(connection.db, artifactRoot);
    const orgs = connection.db.prepare("select id from organizations").all() as Array<{ id: string }>;
    for (const org of orgs) {
      const report = connection.transaction(() => importStagedSkills(skills, org.id, staged));
      if (report.imported > 0 || report.failures.length > 0) {
        console.info(`[skills] org ${org.id}: imported ${report.imported}, skipped ${report.skipped}, failures ${report.failures.length}`);
        for (const failure of report.failures.slice(0, 5)) console.warn(`[skills] ${failure}`);
      }
    }
  } catch (error) {
    console.error(`[skills] built-in skill sync failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
