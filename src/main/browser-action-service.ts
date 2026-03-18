import { join } from "node:path";
import type { AppDatabase } from "./database";
import { BrowserManager } from "./browser-manager";

interface BrowserActionDependencies {
  db: AppDatabase;
  browserManagerRef: { current: BrowserManager | null };
  publishDomainChanged: () => void;
}

export function createBrowserActionService({
  db,
  browserManagerRef,
  publishDomainChanged,
}: BrowserActionDependencies) {
  function requireBrowserManager() {
    if (!browserManagerRef.current) {
      throw new Error("Browser manager is not initialized.");
    }
    return browserManagerRef.current;
  }

  async function dispatchBrowserAction(actionId: string, companyId: string) {
    const action = db.getBrowserAction(actionId, companyId);
    if (!action) {
      throw new Error(`Browser action not found: ${actionId}`);
    }
    if (action.status !== "queued") {
      throw new Error(`Browser action ${actionId} is ${action.status} and cannot be dispatched.`);
    }
    if (action.approvalId) {
      const approval = (() => {
        try {
          return db.getApprovalRecord(action.approvalId);
        } catch {
          return null;
        }
      })();
      if (!approval || approval.companyId !== companyId) {
        throw new Error(`Browser action approval ${action.approvalId} does not belong to company ${companyId}.`);
      }
      if (approval.state !== "approved") {
        db.updateBrowserAction(actionId, {
          status: "approval_required",
          resultSummary: "Browser action is still waiting for approval.",
          errorMessage: "Approval must be granted before execution.",
        });
        publishDomainChanged();
        return;
      }
    }

    const account = db.getSocialAccount(action.socialAccountId, companyId);
    if (!account) {
      db.updateBrowserAction(actionId, {
        status: "failed",
        errorMessage: "Social account no longer exists.",
        finishedAt: new Date().toISOString(),
      });
      publishDomainChanged();
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(action.payloadJson) as Record<string, unknown>;
    } catch {
      db.updateBrowserAction(actionId, {
        status: "failed",
        errorMessage: "Browser action payload is not valid JSON.",
        finishedAt: new Date().toISOString(),
      });
      publishDomainChanged();
      return;
    }

    db.updateBrowserAction(actionId, {
      status: "running",
      startedAt: new Date().toISOString(),
      errorMessage: null,
    });
    publishDomainChanged();

    try {
      const result = await requireBrowserManager().executeAction({
        id: actionId,
        socialAccountId: account.id,
        platform: account.platform,
        actionType: action.actionType,
        payload,
      });

      db.updateBrowserAction(actionId, {
        status: result.cancelled ? "cancelled" : result.success ? "succeeded" : "failed",
        resultSummary: result.summary,
        screenshotPath: result.screenshotPath,
        errorMessage: result.error,
        finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      db.updateBrowserAction(actionId, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        finishedAt: new Date().toISOString(),
      });
    }

    publishDomainChanged();
  }

  async function clearSocialAccountData(socialAccountId: string, screenshotPaths: string[] = []) {
    if (!browserManagerRef.current) {
      return;
    }
    await browserManagerRef.current.clearSocialAccountData(socialAccountId, screenshotPaths);
  }

  function cancelAction(actionId: string) {
    return browserManagerRef.current?.cancelAction(actionId) ?? false;
  }

  async function launchLoginBrowser(socialAccountId: string, platform: string, loginUrl?: string) {
    return requireBrowserManager().launchLoginBrowser(socialAccountId, platform, loginUrl);
  }

  function resetBrowserManager() {
    browserManagerRef.current?.shutdown();
    browserManagerRef.current = new BrowserManager(join(db.artifactsDir, "browser"));
  }

  return {
    dispatchBrowserAction,
    clearSocialAccountData,
    cancelAction,
    launchLoginBrowser,
    resetBrowserManager,
  };
}
