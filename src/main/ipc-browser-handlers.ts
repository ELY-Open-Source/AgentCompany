import {
  IPC_CHANNELS,
  browserActionQuerySchema,
  cancelBrowserActionSchema,
  deleteEntitySchema,
  socialAccountInputSchema,
  triggerBrowserLoginSchema,
} from "@shared/contracts";
import { fail, ok, type RegisterDomainHandlersDependencies } from "./ipc-domain-common";

export function registerBrowserHandlers({
  registerHandle,
  db,
  logger,
  ensureCompanyExists,
  publishDomainChanged,
  getBrowserActions,
}: Pick<
  RegisterDomainHandlersDependencies,
  | "registerHandle"
  | "db"
  | "logger"
  | "ensureCompanyExists"
  | "publishDomainChanged"
  | "getBrowserActions"
>) {
  registerHandle(IPC_CHANNELS.saveSocialAccount, (_event, payload) => {
    const input = socialAccountInputSchema.parse(payload);
    const err = ensureCompanyExists(input.companyId);
    if (err) return err;
    const id = db.saveSocialAccount(input);
    publishDomainChanged();
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.deleteSocialAccount, async (_event, payload) => {
    const input = deleteEntitySchema.parse(payload);
    const err = ensureCompanyExists(input.companyId);
    if (err) return err;
    const browserActions = db.listBrowserActions(input.companyId, { socialAccountId: input.id, limit: 500 });
    await getBrowserActions()?.clearSocialAccountData(
      input.id,
      browserActions.flatMap((action: { screenshotPath: string | null }) => (action.screenshotPath ? [action.screenshotPath] : [])),
    );
    db.deleteSocialAccount(input.id, input.companyId);
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.listBrowserActions, (_event, payload) => {
    const input = browserActionQuerySchema.parse(payload);
    const err = ensureCompanyExists(input.companyId);
    if (err) return err;
    return ok(db.listBrowserActions(input.companyId, {
      socialAccountId: input.socialAccountId,
      status: input.status,
      limit: input.limit,
    }));
  });

  registerHandle(IPC_CHANNELS.cancelBrowserAction, (_event, payload) => {
    const input = cancelBrowserActionSchema.parse(payload);
    const action = db.getBrowserAction(input.actionId, input.companyId);
    if (!action) {
      return fail("BROWSER_ACTION_NOT_FOUND", "Browser action not found.");
    }
    getBrowserActions()?.cancelAction(input.actionId);
    db.updateBrowserAction(input.actionId, {
      status: "cancelled",
      resultSummary: "Browser action cancelled from the desktop control surface.",
      errorMessage: "Action cancelled.",
      finishedAt: new Date().toISOString(),
    });
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.triggerBrowserLogin, async (_event, payload) => {
    const input = triggerBrowserLoginSchema.parse(payload);
    const err = ensureCompanyExists(input.companyId);
    if (err) return err;
    const browserActions = getBrowserActions();
    if (!browserActions) {
      return fail("BROWSER_NOT_READY", "Browser manager not initialized");
    }

    const account = db.getSocialAccount(input.socialAccountId, input.companyId);
    if (!account) {
      return fail("ACCOUNT_NOT_FOUND", "Social account not found");
    }

    browserActions.launchLoginBrowser(input.socialAccountId, account.platform).then((result) => {
      if (result.success) {
        const latestAccount = db.getSocialAccount(input.socialAccountId, account.companyId);
        if (!latestAccount) {
          return;
        }
        db.saveSocialAccount({
          id: latestAccount.id,
          companyId: latestAccount.companyId,
          platform: latestAccount.platform,
          accountName: latestAccount.accountName,
          displayName: latestAccount.displayName,
          profileUrl: latestAccount.profileUrl,
          credentialSecretId: latestAccount.credentialSecretId,
          status: "logged_in",
          requireApproval: latestAccount.requireApproval,
        });
        publishDomainChanged();
      }
    }).catch((error) => {
      logger.error(`[browser] Login failed: ${error}`);
    });

    return ok(true);
  });
}
