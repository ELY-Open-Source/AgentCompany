import type { AppDatabase } from "../database";

interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

export interface RecoverScheduledPostsDeps {
  db: AppDatabase;
  logger: Logger;
  isQuittingRef: { current: boolean };
  getBrowserActionService: () => { dispatchBrowserAction: (actionId: string, companyId: string) => Promise<void> } | null;
}

export function recoverScheduledPosts(deps: RecoverScheduledPostsDeps): Set<ReturnType<typeof setTimeout>> {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  try {
    const snapshot = deps.db.listSnapshot();
    for (const company of snapshot.companies) {
      const queuedActions = deps.db.listBrowserActions(company.id, { status: "queued" });
      for (const action of queuedActions) {
        if (!action.payloadJson) continue;
        try {
          const payload = JSON.parse(action.payloadJson) as { scheduledAt?: string };
          if (!payload.scheduledAt) continue;
          const delay = new Date(payload.scheduledAt).getTime() - Date.now();
          if (delay <= 0) continue;
          const timer = setTimeout(() => {
            timers.delete(timer);
            if (deps.isQuittingRef.current) return;
            const browserActions = deps.getBrowserActionService();
            if (browserActions) {
              void browserActions.dispatchBrowserAction(action.id, company.id);
            }
          }, delay);
          timers.add(timer);
          deps.logger.info(`[bootstrap] Re-registered scheduled post timer: action ${action.id} in ${Math.round(delay / 1000)}s`);
        } catch (error) {
          deps.logger.warn(
            `[bootstrap] malformed scheduled-post payload for action ${action.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  } catch (error) {
    deps.logger.warn(`[bootstrap] Failed to re-register scheduled post timers: ${error instanceof Error ? error.message : String(error)}`);
  }
  return timers;
}
