import { join } from "node:path";
import log from "electron-log/main.js";
import type { AppDatabase } from "./database";
import { BrowserManager } from "./browser-manager";
import { classifyUnknownError, logAppError } from "./errors/index.js";

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

  function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function recordDispatchFailure(actionId: string, companyId: string, error: unknown) {
    const message = formatError(error);
    logAppError(log, error, {
      kind: "upstream",
      code: "browser_action.dispatch.failed",
      message: `Browser action ${actionId} dispatch failed`,
      cause: error,
      context: { actionId, companyId },
    });

    const action = db.core.social.getBrowserAction(actionId, companyId);
    if (action && (action.status === "queued" || action.status === "running")) {
      db.core.social.updateBrowserAction(actionId, {
        status: "failed",
        resultSummary: "Browser action dispatch failed before execution completed.",
        errorMessage: message,
        finishedAt: new Date().toISOString(),
      });
    }
    db.core.activity.addActivity({
      companyId,
      actor: action?.agentId ?? "system",
      action: "browser.action_dispatch_failed",
      entityType: "browser_action",
      entityId: actionId,
      detail: message,
    });
    log.info("[browser] action dispatch telemetry", {
      actionId,
      companyId,
      final_outcome: "dispatch_failed",
      error: message,
    });
    publishDomainChanged();
  }

  function queueBrowserActionExecution(actionId: string, companyId: string): void {
    void dispatchBrowserAction(actionId, companyId).catch((error) => {
      try {
        recordDispatchFailure(actionId, companyId, error);
      } catch (recordError) {
        logAppError(log, recordError, {
          kind: "fatal",
          code: "browser_action.dispatch_failure_record.failed",
          message: `Failed to record browser action ${actionId} dispatch failure`,
          cause: recordError,
          context: { actionId, companyId, dispatchError: formatError(error) },
        });
      }
    });
  }

  /**
   * Returns the approval record for `approvalId`, or null if the record is
   * missing. Isolates the "approval row disappeared" case so the caller does
   * not need to nest a try/catch around the state machine.
   */
  function getApprovalOrNull(approvalId: string): ReturnType<typeof db.core.approvals.getApprovalRecord> | null {
    try {
      return db.core.approvals.getApprovalRecord(approvalId);
    } catch (err) {
      const classified = classifyUnknownError(err, {
        kind: "recoverable",
        code: "browser_action.approval.lookup_failed",
        message: `getApprovalRecord failed for ${approvalId}`,
        context: { approvalId },
      });
      log.warn(`[${classified.code}]`, classified.message, classified.context);
      return null;
    }
  }

  async function dispatchBrowserAction(actionId: string, companyId: string) {
    const action = db.core.social.getBrowserAction(actionId, companyId);
    if (!action) {
      throw new Error(`Browser action not found: ${actionId}`);
    }
    if (action.status !== "queued") {
      throw new Error(`Browser action ${actionId} is ${action.status} and cannot be dispatched.`);
    }
    if (action.approvalId) {
      const approval = getApprovalOrNull(action.approvalId);
      if (!approval || approval.companyId !== companyId) {
        throw new Error(`Browser action approval ${action.approvalId} does not belong to company ${companyId}.`);
      }
      if (approval.state !== "approved") {
        db.core.social.updateBrowserAction(actionId, {
          status: "approval_required",
          resultSummary: "Browser action is still waiting for approval.",
          errorMessage: "Approval must be granted before execution.",
        });
        publishDomainChanged();
        return;
      }
    }

    const account = db.core.social.getSocialAccount(action.socialAccountId, companyId);
    if (!account) {
      db.core.social.updateBrowserAction(actionId, {
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
    } catch (err) {
      const classified = classifyUnknownError(err, {
        kind: "user_input",
        code: "browser_action.payload.invalid_json",
        message: `Browser action ${actionId} has invalid JSON payload`,
        context: { actionId },
      });
      log.warn(`[${classified.code}]`, classified.message, classified.context);
      db.core.social.updateBrowserAction(actionId, {
        status: "failed",
        errorMessage: "Browser action payload is not valid JSON.",
        finishedAt: new Date().toISOString(),
      });
      publishDomainChanged();
      return;
    }

    db.core.social.updateBrowserAction(actionId, {
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

      db.core.social.updateBrowserAction(actionId, {
        status: result.cancelled ? "cancelled" : result.success ? "succeeded" : "failed",
        resultSummary: result.summary,
        screenshotPath: result.screenshotPath,
        errorMessage: result.error,
        finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      db.core.social.updateBrowserAction(actionId, {
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

  async function resetBrowserManager() {
    await browserManagerRef.current?.shutdown();
    browserManagerRef.current = new BrowserManager(join(db.artifactsDir, "browser"));
  }

  async function extractProfileFromSession(socialAccountId: string, platform: string) {
    return requireBrowserManager().extractProfileFromSession(socialAccountId, platform);
  }

  return {
    dispatchBrowserAction,
    queueBrowserActionExecution,
    clearSocialAccountData,
    cancelAction,
    launchLoginBrowser,
    extractProfileFromSession,
    resetBrowserManager,
  };
}
