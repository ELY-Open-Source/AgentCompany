import { app } from "electron";
import electronUpdater from "electron-updater";
import type { AppDatabase } from "./database";
import type { NotificationOptions } from "./notification-service";
import { classifyUnknownError } from "./errors/index.js";

const { autoUpdater } = electronUpdater;

interface UpdaterServiceDependencies {
  db: AppDatabase;
  logger: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  notify: (options: NotificationOptions) => void;
}

type SkipUpdateReason = "updates_disabled" | "insecure_url" | "dev_without_real_url";

function shouldSkipUpdateCheck(input: {
  isPackaged: boolean;
  updatesEnabled: boolean;
  updateUrl: string | undefined;
  updatesDisabledEnv: boolean;
}): SkipUpdateReason | null {
  if (!input.updatesEnabled || input.updatesDisabledEnv) {
    return "updates_disabled";
  }
  if (input.updateUrl && !input.updateUrl.startsWith("https://")) {
    return "insecure_url";
  }
  if (!input.isPackaged && (!input.updateUrl || input.updateUrl.includes("example.invalid"))) {
    return "dev_without_real_url";
  }
  return null;
}

export function createUpdaterService({
  db,
  logger,
  notify,
}: UpdaterServiceDependencies) {
  let listenersAttached = false;
  /**
   * Set by checkForUpdates({ manual: true }) from the UI. Gates the
   * "Up to Date" toast so the auto-every-24h check stays silent when
   * nothing happened. Cleared inside the update-not-available handler.
   */
  let manualCheckPending = false;

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
      manualCheckPending = false;
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
      if (!manualCheckPending) {
        return;
      }
      manualCheckPending = false;
      notify({
        title: "Up to Date",
        body: "You are running the latest version",
        urgency: "informational",
        navigation: { section: "settings" },
      });
    });
    autoUpdater.on("error", (error) => {
      logger.error("[updater] error", error);
      manualCheckPending = false;
      notify({
        title: "Update Check Failed",
        body: "Could not check for updates. Try again later.",
        urgency: "informational",
        navigation: { section: "settings" },
      });
    });
  }

  async function checkForUpdates(options: { manual?: boolean } = {}) {
    const snapshot = db.projection.snapshot.listSnapshot();
    const updateUrl = process.env.AGENTCOMPANY_UPDATE_URL?.trim();
    const skipReason = shouldSkipUpdateCheck({
      isPackaged: app.isPackaged,
      updatesEnabled: snapshot.updatesEnabled,
      updateUrl,
      updatesDisabledEnv: process.env.AGENTCOMPANY_DISABLE_UPDATES === "true",
    });
    if (skipReason === "insecure_url") {
      logger.error("[updater] AGENTCOMPANY_UPDATE_URL must use HTTPS — refusing insecure update source.");
      return false;
    }
    if (skipReason === "dev_without_real_url") {
      logger.info("[updater] Skipping update check because no real update URL is configured.");
      return false;
    }
    if (skipReason) {
      return false;
    }
    if (options.manual) {
      manualCheckPending = true;
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
      const classified = classifyUnknownError(error, {
        kind: "upstream",
        code: "updater.check_for_updates.failed",
        message: "autoUpdater.checkForUpdates() failed",
      });
      logger.error(`[${classified.code}] ${classified.message}`, error);
      manualCheckPending = false;
      return false;
    }
  }

  return {
    attachListeners,
    checkForUpdates,
  };
}
