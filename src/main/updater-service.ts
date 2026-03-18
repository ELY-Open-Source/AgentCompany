import electronUpdater from "electron-updater";
import type { AppDatabase } from "./database";

const { autoUpdater } = electronUpdater;

interface UpdaterServiceDependencies {
  db: AppDatabase;
  logger: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  notify: (title: string, body: string) => void;
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
      notify("Update available", `AgentCompany ${info.version} is available to download.`);
    });
    autoUpdater.on("update-not-available", () => {
      notify("No updates found", "AgentCompany is already on the latest configured version.");
    });
    autoUpdater.on("error", (error) => {
      logger.error("[updater] error", error);
      notify("Update check failed", error instanceof Error ? error.message : String(error));
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
