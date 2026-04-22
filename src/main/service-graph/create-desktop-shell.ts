import type { IpcMainInvokeEvent } from "electron";
import type { AppDatabase } from "../database";
import type { DesktopEvent } from "@shared/types";
import type { DesktopResult } from "@shared/contracts";
import { createDesktopShellService } from "../desktop-shell-service";
import type { NotificationOptions } from "../notification-service";

export interface DesktopShellDeps {
  db: AppDatabase;
  preloadPath: string;
  rendererDist: string;
  iconPath: string;
  isDev: boolean;
  devServerUrl?: string;
  windowStatePath: string;
  isQuittingRef: { current: boolean };
  emitEvent: (event: DesktopEvent) => void;
  notify: (options: NotificationOptions) => void;
  registerHandle: (
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<DesktopResult<unknown>> | DesktopResult<unknown>,
  ) => void;
  checkForUpdates: () => Promise<void>;
  logger: { warn: (...args: unknown[]) => void };
}

/** Build the desktop shell service with concrete updater and window callbacks. */
export function createDesktopShell({
  db,
  preloadPath,
  rendererDist,
  iconPath,
  isDev,
  devServerUrl,
  windowStatePath,
  isQuittingRef,
  emitEvent,
  notify,
  registerHandle,
  checkForUpdates,
  logger,
}: DesktopShellDeps) {
  const desktopShellService = createDesktopShellService({
    preloadPath,
    rendererDist,
    iconPath,
    isDev,
    devServerUrl,
    windowStatePath,
    registerHandle,
    shouldQuit: () => isQuittingRef.current,
    onRequestQuit: () => {
      isQuittingRef.current = true;
    },
    onCheckForUpdates: async () => {
      await checkForUpdates();
    },
    onBackupProfile: async () => {
      const target = await import("electron").then(({ dialog }) => dialog.showOpenDialog({
        properties: ["openDirectory", "createDirectory"],
      }));
      if (target.canceled || target.filePaths.length === 0) return;
      await db.core.backup.exportBackup(`${target.filePaths[0]!}/agentcompany-backup-${Date.now()}`);
    },
    onShortcut: (action) => emitEvent({ type: "shortcut", action }),
    notify,
    getActiveRunCount: () => {
      try {
        const snapshot = db.projection.snapshot.listSnapshot();
        return snapshot.runs.filter((r) => r.status === "running" || r.status === "queued").length;
      } catch (error) {
        logger.warn("[service-graph] getActiveRunCount failed:", error);
        return 0;
      }
    },
  });
  desktopShellService.initialize();
  return desktopShellService;
}
