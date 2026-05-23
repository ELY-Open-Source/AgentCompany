import { ipcMain, shell, type BrowserWindow } from "electron";
import type { DatabaseConnection } from "../database/connection";
import { IPC_CHANNELS } from "../../shared/ipc";
import { fail, ok, type DesktopResult } from "../../shared/result";
import type { AppSnapshot } from "../../shared/domain";
import { SnapshotService } from "../services/snapshot-service";
import { OrganizationService } from "../services/organization-service";
import { ApprovalService } from "../services/approval-service";
import { ChatService } from "../services/chat-service";
import { ProviderService } from "../services/provider-service";
import { SkillService } from "../services/skill-service";
import { SocialService } from "../services/social-service";
import { FileService } from "../services/file-service";
import { MigrationService } from "../services/migration-service";
import { OnboardingService } from "../services/onboarding-service";
import { ComplianceService } from "../services/compliance-service";
import { SearchService } from "../services/search-service";
import { IdentityAccessService } from "../services/identity-access-service";
import { OperationsService } from "../services/operations-service";
import { SdlcService } from "../services/sdlc-service";
import { AuditService } from "../services/audit-service";

export interface IpcDeps {
  connection: DatabaseConnection;
  mainWindow: BrowserWindow;
  artifactRoot: string;
}

export function registerIpcHandlers(deps: IpcDeps): void {
  const snapshot = new SnapshotService(deps.connection.db);
  const organization = new OrganizationService(deps.connection.db);
  const approvals = new ApprovalService(deps.connection.db);
  const chat = new ChatService(deps.connection.db);
  const providers = new ProviderService(deps.connection.db);
  const skills = new SkillService(deps.connection.db, deps.artifactRoot);
  const social = new SocialService(deps.connection.db);
  const files = new FileService(deps.connection.db, deps.artifactRoot);
  const migrations = new MigrationService(deps.connection.db);
  const compliance = new ComplianceService(deps.connection.db);
  const search = new SearchService(deps.connection.db);
  const identityAccess = new IdentityAccessService(deps.connection.db);
  const operations = new OperationsService(deps.connection.db);
  const sdlc = new SdlcService(deps.connection.db);
  const audit = new AuditService(deps.connection.db);
  const onboarding = new OnboardingService({
    db: deps.connection.db,
    saveProviderCredential: (input) => providers.saveCredential(input),
  });

  const mutate = <T>(operation: () => T): DesktopResult<AppSnapshot> => {
    try {
      deps.connection.transaction(operation);
      deps.mainWindow.webContents.send(IPC_CHANNELS.rendererEvent, { type: "snapshot-changed" });
      return ok(snapshot.load());
    } catch (error) {
      return fail("operation_failed", error instanceof Error ? error.message : String(error));
    }
  };

  ipcMain.handle(IPC_CHANNELS.loadSnapshot, () => {
    try {
      return ok(snapshot.load());
    } catch (error) {
      return fail("snapshot_failed", error instanceof Error ? error.message : String(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.bootstrapOnboarding, (_event, input) => {
    try {
      let summary;
      deps.connection.transaction(() => {
        summary = onboarding.bootstrap(input);
      });
      deps.mainWindow.webContents.send(IPC_CHANNELS.rendererEvent, { type: "snapshot-changed" });
      return ok(summary);
    } catch (error) {
      return fail("onboarding_failed", error instanceof Error ? error.message : String(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.createOrganization, (_event, input) => mutate(() => organization.createOrganization(input)));
  ipcMain.handle(IPC_CHANNELS.setActiveOrganization, (_event, input) => mutate(() => organization.setActiveOrganization(input.orgId)));
  ipcMain.handle(IPC_CHANNELS.deleteOrganization, (_event, input) => mutate(() => organization.deleteOrganization(input.orgId)));
  ipcMain.handle(IPC_CHANNELS.createAgent, (_event, input) => mutate(() => organization.createAgent(input)));
  ipcMain.handle(IPC_CHANNELS.createTask, (_event, input) => mutate(() => organization.createTask(input)));
  ipcMain.handle(IPC_CHANNELS.updateTaskStatus, (_event, input) => mutate(() => organization.updateTaskStatus(input.orgId, input.taskId, input.status)));
  ipcMain.handle(IPC_CHANNELS.createApproval, (_event, input) => mutate(() => approvals.create(input)));
  ipcMain.handle(IPC_CHANNELS.decideApproval, (_event, input) => mutate(() => approvals.decide(input)));
  ipcMain.handle(IPC_CHANNELS.syncEmployeeIdentity, (_event, input) => mutate(() => identityAccess.syncEmployeeIdentity(input)));
  ipcMain.handle(IPC_CHANNELS.grantRole, (_event, input) => mutate(() => identityAccess.grantRole(input)));
  ipcMain.handle(IPC_CHANNELS.createChatSpace, (_event, input) => mutate(() => chat.createSpace(input)));
  ipcMain.handle(IPC_CHANNELS.sendMessage, (_event, input) => mutate(() => chat.sendMessage(input)));
  ipcMain.handle(IPC_CHANNELS.markChatSpaceRead, (_event, input) => mutate(() => chat.markSpaceRead(input)));
  ipcMain.handle(IPC_CHANNELS.saveProviderCredential, (_event, input) => mutate(() => providers.saveCredential(input)));
  ipcMain.handle(IPC_CHANNELS.updateProviderPolicy, (_event, input) => mutate(() => providers.updatePolicy(input)));
  ipcMain.handle(IPC_CHANNELS.checkProviderHealth, async (_event, input) => {
    try {
      await providers.checkHealth(input.orgId, input.providerId);
      deps.mainWindow.webContents.send(IPC_CHANNELS.rendererEvent, { type: "snapshot-changed" });
      return ok(snapshot.load());
    } catch (error) {
      return fail("provider_health_failed", error instanceof Error ? error.message : String(error));
    }
  });
  ipcMain.handle(IPC_CHANNELS.launchProviderSignIn, (_event, input) => {
    try {
      providers.launchSignInWindow(input.orgId, input.providerId);
      return ok(null);
    } catch (error) {
      return fail("provider_sign_in_failed", error instanceof Error ? error.message : String(error));
    }
  });
  ipcMain.handle(IPC_CHANNELS.openExternalUrl, async (_event, url: string) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return fail("external_url_blocked", "Only http(s) URLs may be opened externally.");
      }
      await shell.openExternal(parsed.toString());
      return ok(null);
    } catch (error) {
      return fail("external_url_failed", error instanceof Error ? error.message : String(error));
    }
  });
  ipcMain.handle(IPC_CHANNELS.createProviderResponse, async (_event, input) => {
    try {
      await providers.createResponse(input);
      deps.mainWindow.webContents.send(IPC_CHANNELS.rendererEvent, { type: "snapshot-changed" });
      return ok(snapshot.load());
    } catch (error) {
      return fail("provider_response_failed", error instanceof Error ? error.message : String(error));
    }
  });
  ipcMain.handle(IPC_CHANNELS.importSkillDirectory, (_event, input) => mutate(() => skills.importDirectory(input)));
  ipcMain.handle(IPC_CHANNELS.bindSkill, (_event, input) => mutate(() => skills.bind(input)));
  ipcMain.handle(IPC_CHANNELS.resolveAgentSkills, (_event, input) => mutate(() => skills.resolveRuntimeSnapshot(input)));
  ipcMain.handle(IPC_CHANNELS.createSocialAccount, (_event, input) => mutate(() => social.createAccount(input)));
  ipcMain.handle(IPC_CHANNELS.createScheduledPost, (_event, input) => mutate(() => social.createScheduledPost(input)));
  ipcMain.handle(IPC_CHANNELS.setScheduledPostState, (_event, input) => mutate(() => social.setScheduledPostState(input)));
  ipcMain.handle(IPC_CHANNELS.setFilePinned, (_event, input) => mutate(() => files.setPinned(input.orgId, input.fileId, input.pinned)));

  ipcMain.handle(IPC_CHANNELS.launchSocialLogin, (_event, input) => {
    try {
      social.launchLoginWindow(input);
      return ok(null);
    } catch (error) {
      return fail("social_login_failed", error instanceof Error ? error.message : String(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.importFile, async (_event, input) => {
    try {
      await files.importFile(input);
      deps.mainWindow.webContents.send(IPC_CHANNELS.rendererEvent, { type: "snapshot-changed" });
      return ok(snapshot.load());
    } catch (error) {
      return fail("file_import_failed", error instanceof Error ? error.message : String(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.createMigrationReport, (_event, input) => mutate(() => migrations.createReport(input)));
  ipcMain.handle(IPC_CHANNELS.setFeatureFlag, (_event, input) => mutate(() => operations.setFeatureFlag(input)));
  ipcMain.handle(IPC_CHANNELS.runChaosDrill, (_event, input) => mutate(() => operations.runChaosDrill(input)));
  ipcMain.handle(IPC_CHANNELS.runSdlcReview, (_event, input) => mutate(() => sdlc.runReview(input)));
  ipcMain.handle(IPC_CHANNELS.runEvalSuite, (_event, input) => mutate(() => sdlc.runEvalSuite(input)));
  ipcMain.handle(IPC_CHANNELS.setPrBotGate, (_event, input) => mutate(() => sdlc.setPrBotGate(input)));
  ipcMain.handle(IPC_CHANNELS.createComplianceExport, (_event, input) => mutate(() => compliance.createExport(input)));
  ipcMain.handle(IPC_CHANNELS.createAuditReplay, (_event, input) => mutate(() => audit.createThreadReplay(input)));
  ipcMain.handle(IPC_CHANNELS.createLegalHold, (_event, input) => mutate(() => compliance.createLegalHold(input)));
  ipcMain.handle(IPC_CHANNELS.setLegalHoldState, (_event, input) => mutate(() => compliance.setLegalHoldState(input)));
  ipcMain.handle(IPC_CHANNELS.createRetentionFreeze, (_event, input) => mutate(() => compliance.createRetentionFreeze(input)));
  ipcMain.handle(IPC_CHANNELS.setRetentionFreezeState, (_event, input) => mutate(() => compliance.setRetentionFreezeState(input)));
  ipcMain.handle(IPC_CHANNELS.search, (_event, input) => {
    try {
      return ok(search.search(input));
    } catch (error) {
      return fail("search_failed", error instanceof Error ? error.message : String(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.windowMinimize, () => deps.mainWindow.minimize());
  ipcMain.handle(IPC_CHANNELS.windowMaximize, () => deps.mainWindow.isMaximized() ? deps.mainWindow.unmaximize() : deps.mainWindow.maximize());
  ipcMain.handle(IPC_CHANNELS.windowClose, () => deps.mainWindow.close());
}
