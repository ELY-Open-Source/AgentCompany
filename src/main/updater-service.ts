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
  function attachListeners() {
    autoUpdater.on("checking-for-update", () => {
      logger.info("[updater] checking for updates");
    });
    autoUpdater.on("update-available", (info) => {
      notify({
        title: "Update Available",
        body: `Version ${info.version} is ready to install`,
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
    if (!updateUrl || updateUrl.includes("example.invalid")) {
      logger.info("[updater] Skipping update check because no real update URL is configured.");
      return false;
    }
    try {
      autoUpdater.logger = logger as any;
      autoUpdater.autoDownload = false;
      await autoUpdater.checkForUpdates();
      return true;
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
