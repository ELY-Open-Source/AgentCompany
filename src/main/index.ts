import { app } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseConnection } from "./database/connection";
import { appPageUrl, createMainWindow } from "./app/create-window";
import { registerIpcHandlers } from "./app/ipc-handlers";
import { builtinSkillsSourceOverride, importStagedSkills, stageBuiltinSkillsLibrary } from "./services/builtin-skills";
import { ensureCeoDirectSpace } from "./services/ceo-direct-space";
import { SkillService } from "./services/skill-service";
import { startProviderBackgroundWorker } from "./app/provider-background-worker";
import { recoverInterruptedWork } from "./app/startup-recovery";
import { startTaskQueueWorker } from "./app/task-queue-worker";
import { confirmDiscardOnClose } from "./app/unsaved-guard";
import { stopAllRunsAndWait } from "./services/run-control";
import { appLanguage } from "./services/work-language";

const QUIT_GRACE_MS = 10_000;

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
  const language = appLanguage(connection.db);
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
      appPage: appPageUrl({ devServerUrl: process.env.ELECTRON_RENDERER_URL, rendererDist: join(__dirname, "../renderer") }),
      artifactRoot: join(profileDir, "artifacts"),
      builtinSkillsSource,
      builtinSkillsLibrary,
    });
    syncAllOrganizationSkills(connection, join(profileDir, "artifacts"), builtinSkillsSource, builtinSkillsLibrary);
    ensureAllCeoConversations(connection);
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

    let shutdown: "running" | "draining" | "drained" = "running";
    const uiLanguage = language === "zh" ? "zh" : "en";
    // Asked before anything shuts down, so choosing to stay leaves the app fully running.
    win.on("close", (event) => {
      if (shutdown === "running" && !confirmDiscardOnClose(win, uiLanguage)) event.preventDefault();
    });
    app.on("before-quit", (event) => {
      if (shutdown === "drained") return;
      if (shutdown === "running" && !confirmDiscardOnClose(win, uiLanguage)) {
        event.preventDefault();
        return;
      }
      // Hold every exit request until running sessions are stopped and have recorded how they ended.
      event.preventDefault();
      if (shutdown === "draining") return;
      shutdown = "draining";
      stopProviderBackgroundWorker();
      stopTaskQueueWorker();
      void stopAllRunsAndWait("The app was closing.", QUIT_GRACE_MS).then((unsettled) => {
        if (unsettled > 0) console.warn(`[quit] ${unsettled} run(s) did not settle within ${QUIT_GRACE_MS}ms; startup recovery will re-queue them.`);
        connection.close();
        shutdown = "drained";
        app.quit();
      });
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
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
      if (report.imported > 0 || report.upgraded > 0 || report.restored > 0 || report.retired > 0 || report.failures.length > 0) {
        console.info(`[skills] org ${org.id}: imported ${report.imported}, upgraded ${report.upgraded}, restored ${report.restored}, skipped ${report.skipped}, retired ${report.retired}, failures ${report.failures.length}`);
        for (const failure of report.failures.slice(0, 5)) console.warn(`[skills] ${failure}`);
      }
    }
  } catch (error) {
    console.error(`[skills] built-in skill sync failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Repairs the founder⇄CEO conversation invariant for every organization at
 * startup — orgs created before the pinned CEO chat existed get theirs here.
 * A broken org is loud in the log but must not stop the app.
 */
function ensureAllCeoConversations(connection: DatabaseConnection): void {
  const orgs = connection.db.prepare("select id from organizations").all() as Array<{ id: string }>;
  for (const org of orgs) {
    try {
      connection.transaction(() => ensureCeoDirectSpace(connection.db, org.id));
    } catch (error) {
      console.error(`[chat] ensuring the CEO conversation for org ${org.id} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
