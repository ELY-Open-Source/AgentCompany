import { Notification, app } from "electron";
import type { BrowserWindow } from "electron";
import type { DesktopEvent, SectionId } from "@shared/types";

export interface NotificationOptions {
  title: string;
  body: string;
  urgency: "critical" | "informational";
  navigation?: {
    section: SectionId;
    entityId?: string;
  };
  /** Batch key -- notifications with same key within window are batched */
  batchKey?: string;
}

interface NotificationServiceDependencies {
  getMainWindow: () => BrowserWindow | null;
  emitEvent: (event: DesktopEvent) => void;
  logger: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

interface BatchState {
  count: number;
  timer: ReturnType<typeof setTimeout>;
  section: SectionId;
}

const BATCH_WINDOW_MS = 10_000;

/**
 * Batch keys that should NEVER be batched -- always fire individually.
 * These represent events the user must see each instance of.
 */
const NEVER_BATCH: ReadonlySet<string> = new Set([
  "pending_approval",
  "crash_recovery",
  "update_available",
  "manual_intervention",
  "budget_exhaustion",
]);

/**
 * Batch summary copy per batch key.
 * Used when the batch timer expires and accumulated events need a summary notification.
 */
const BATCH_SUMMARY_COPY: Record<string, { title: (count: number) => string; body: string }> = {
  failed_runs: {
    title: (count) => `${count} tasks failed`,
    body: "Click to view failed runs",
  },
  agent_hired: {
    title: (count) => `${count} agents hired`,
    body: "Click to view organization",
  },
  budget_alerts: {
    title: (count) => `${count} budget alerts`,
    body: "Click to view cost details",
  },
  task_completed: {
    title: (count) => `${count} tasks completed`,
    body: "Click to view task list",
  },
  agent_paused: {
    title: (count) => `${count} agents paused`,
    body: "Click to view paused agents",
  },
};

export function createNotificationService(deps: NotificationServiceDependencies) {
  /**
   * Prevent GC on Windows -- Notification objects must be retained
   * while visible so click handlers fire. Removed on "close" event.
   */
  const activeNotifications: Set<Notification> = new Set();

  /** Active batch state per batch key */
  const activeBatches: Map<string, BatchState> = new Map();

  function notify(options: NotificationOptions) {
    if (!Notification.isSupported()) return;

    const key = options.batchKey;

    // If no batch key, or the key is in the NEVER_BATCH list, fire immediately
    if (!key || NEVER_BATCH.has(key)) {
      fireNotification(options);
      return;
    }

    const existing = activeBatches.get(key);
    if (!existing) {
      // First event in batch -- fire immediately, start batch window
      fireNotification(options);
      activeBatches.set(key, {
        count: 0,
        timer: setTimeout(() => flushBatch(key), BATCH_WINDOW_MS),
        section: options.navigation?.section ?? "overview",
      });
      return;
    }

    // Accumulate -- do not fire individual notification
    existing.count++;
  }

  function flushBatch(key: string) {
    const batch = activeBatches.get(key);
    activeBatches.delete(key);

    if (batch && batch.count > 0) {
      const copy = BATCH_SUMMARY_COPY[key];
      const title = copy ? copy.title(batch.count) : `${batch.count} more events`;
      const body = copy ? copy.body : "Click to view";

      fireNotification({
        title,
        body,
        urgency: "informational",
        navigation: { section: batch.section },
        // No entityId -- batched summary navigates to section overview
      });
    }
  }

  function fireNotification(options: NotificationOptions) {
    if (!Notification.isSupported()) return;

    const notificationOptions: Electron.NotificationConstructorOptions = {
      title: options.title,
      body: options.body,
      silent: options.urgency === "informational",
    };

    // Platform-specific urgency handling
    if (process.platform === "win32" && options.urgency === "critical") {
      notificationOptions.timeoutType = "never";
    }
    if (process.platform === "linux") {
      notificationOptions.urgency = options.urgency === "critical" ? "critical" : "normal";
    }

    const notification = new Notification(notificationOptions);

    // Click handler: restore window and navigate (D-02 window restoration sequence)
    notification.on("click", () => {
      app.focus({ steal: true });
      const win = deps.getMainWindow();
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
      if (options.navigation) {
        deps.emitEvent({
          type: "notification-click",
          section: options.navigation.section,
          entityId: options.navigation.entityId,
        });
      }
    });

    // GC protection: hold reference until notification closes
    notification.on("close", () => {
      activeNotifications.delete(notification);
    });

    notification.show();
    activeNotifications.add(notification);
  }

  function destroy() {
    // Clear all batch timers
    for (const batch of activeBatches.values()) {
      clearTimeout(batch.timer);
    }
    activeBatches.clear();
    activeNotifications.clear();
  }

  return {
    notify,
    destroy,
  };
}
