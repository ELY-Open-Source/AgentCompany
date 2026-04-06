import { app } from "electron";
import electronUpdater from "electron-updater";
import type { AppDatabase } from "./database";
import type { NotificationOptions } from "./notification-service";

const { autoUpdater } = electronUpdater;

interface UpdaterServiceDependencies {
  db: AppDatabase;
  logger: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  notify: (options: NotificationOptions) => void;
}

export function createUpdaterService({
  db,
  logger,
  notify,
}: UpdaterServiceDependencies) {
  let listenersAttached = false;

  function attachListeners() {
    if (listenersAttached) {
      return;
    }
    listenersAttached = true;
    autoUpdater.on("checking-for-update", () => {
      logger.info("[updater] checking for updates");
    });
    autoUpdater.on("update-available", (info) => {
      logger.info("[updater] update available", info.version);
      notify({
        title: "Update Available",
        body: `Version ${info.version} is downloading in the background`,
        urgency: "informational",
        navigation: { section: "settings" },
      });
    });
    autoUpdater.on("download-progress", (progress) => {
      logger.info("[updater] download progress", {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
      });
    });
    autoUpdater.on("update-downloaded", (info) => {
      logger.info("[updater] update downloaded", info.version);
      notify({
        title: "Update Ready",
        body: `Version ${info.version} will install when AgentCompany quits`,
        urgency: "informational",
        navigation: { section: "settings" },
      });
    });
    autoUpdater.on("update-not-available", () => {
      notify({
        title: "Up to Date",
        body: "You are running the latest version",
        urgency: "informational",
        navigation: { section: "settings" },
      });
    });
    autoUpdater.on("error", (error) => {
      logger.error("[updater] error", error);
      notify({
        title: "Update Check Failed",
        body: "Could not check for updates. Try again later.",
        urgency: "informational",
        navigation: { section: "settings" },
      });
    });
  }

  async function checkForUpdates() {
    const snapshot = db.listSnapshot();
    if (!snapshot.updatesEnabled || process.env.AGENTCOMPANY_DISABLE_UPDATES === "true") {
      return false;
    }
    const updateUrl = process.env.AGENTCOMPANY_UPDATE_URL?.trim();
    if (updateUrl && !updateUrl.startsWith("https://")) {
      logger.error("[updater] AGENTCOMPANY_UPDATE_URL must use HTTPS — refusing insecure update source.");
      return false;
    }
    if (!app.isPackaged && (!updateUrl || updateUrl.includes("example.invalid"))) {
      logger.info("[updater] Skipping update check because no real update URL is configured.");
      return false;
    }
    try {
      autoUpdater.logger = {
        info: (...args: unknown[]) => logger.info(...args),
        warn: (...args: unknown[]) => logger.info("[warn]", ...args),
        error: (...args: unknown[]) => logger.error(...args),
        debug: () => undefined,
      };
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      const result = await autoUpdater.checkForUpdates();
      return Boolean(result?.updateInfo);
    } catch (error) {
      logger.error(error);
      return false;
    }
  }

  return {
    attachListeners,
    checkForUpdates,
  };
}
