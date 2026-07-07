import { app, dialog, ipcMain, shell, type BrowserWindow } from "electron";
import type { DatabaseConnection } from "../database/connection";
import { IPC_CHANNELS } from "../../shared/ipc";
import { fail, ok, type DesktopResult } from "../../shared/result";
import type { AppSnapshot } from "../../shared/domain";
import { SnapshotService } from "../services/snapshot-service";
import { OrganizationService } from "../services/organization-service";
import { ApprovalService } from "../services/approval-service";
import { ChatService } from "../services/chat-service";
import { ProviderService } from "../services/provider-service";
import { ProviderOAuthService } from "../services/provider-oauth-service";
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
import { RollbackService } from "../services/rollback-service";
import { TaskExecutionService } from "../services/task-execution-service";
import { DocumentService } from "../services/document-service";
import { KnowledgeService } from "../services/knowledge-service";
import { AutomationService } from "../services/automation-service";
import { MeetingService } from "../services/meeting-service";
import { SprintService } from "../services/sprint-service";
import { ComposioConnectionService } from "../services/composio/composio-connection-service";
import { syncSkillsFromDisk } from "../services/skill-discovery";
import { coalesce } from "./coalesce";
import { normalizeExternalBrowserUrl } from "./external-url";

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
  const providerOAuth = new ProviderOAuthService();
  const skills = new SkillService(deps.connection.db, deps.artifactRoot);
  const notifyDataChanged = coalesce(() => {
    try {
      if (!deps.mainWindow.isDestroyed() && !deps.mainWindow.webContents.isDestroyed()) {
        deps.mainWindow.webContents.send(IPC_CHANNELS.rendererEvent, { type: "snapshot-changed" });
      }
    } catch { /* renderer may have been disposed during agent run */ }
  }, 200);
  const taskExecution = new TaskExecutionService(deps.connection.db, providers, skills, notifyDataChanged);
  const social = new SocialService(deps.connection.db);
  const files = new FileService(deps.connection.db, deps.artifactRoot);
  const migrations = new MigrationService(deps.connection.db);
  const compliance = new ComplianceService(deps.connection.db);
  const search = new SearchService(deps.connection.db);
  const identityAccess = new IdentityAccessService(deps.connection.db);
  const operations = new OperationsService(deps.connection.db);
  const sdlc = new SdlcService(deps.connection.db);
  const audit = new AuditService(deps.connection.db);
  const rollback = new RollbackService(deps.connection.db);
  const documents = new DocumentService(deps.connection.db);
  const knowledge = new KnowledgeService(deps.connection.db);
  const automation = new AutomationService(deps.connection.db);
  const meetingService = new MeetingService(deps.connection.db);
  const sprintService = new SprintService(deps.connection.db);
  const onboarding = new OnboardingService({
    db: deps.connection.db,
    saveProviderCredential: (input) => providers.saveCredential(input),
  });

  const mutate = <T>(operation: () => T): DesktopResult<AppSnapshot> => {
    try {
      deps.connection.transaction(operation);
      notifyDataChanged();
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
      notifyDataChanged();
      return ok(summary);
    } catch (error) {
      return fail("onboarding_failed", error instanceof Error ? error.message : String(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.createOrganization, (_event, input) => mutate(() => organization.createOrganization(input)));
  ipcMain.handle(IPC_CHANNELS.setActiveOrganization, (_event, input) => mutate(() => organization.setActiveOrganization(input.orgId)));
  ipcMain.handle(IPC_CHANNELS.setUiPreferences, (_event, input) => {
    const before = snapshot.load().uiPreferences.language;
    const result = mutate(() => organization.updateUiPreferences(input));
    if (result.ok && result.data.uiPreferences.language !== before) {
      // Chromium's locale is fixed at launch; a language change needs a
      // fresh process to take effect.
      setTimeout(() => {
        app.relaunch();
        app.quit();
      }, 150);
    }
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.deleteOrganization, (_event, input) => mutate(() => organization.deleteOrganization(input.orgId)));
  ipcMain.handle(IPC_CHANNELS.createAgent, (_event, input) => mutate(() => organization.createAgent(input)));
  ipcMain.handle(IPC_CHANNELS.updateAgent, (_event, input) => mutate(() => organization.updateAgent(input)));
  ipcMain.handle(IPC_CHANNELS.createTask, (_event, input) => mutate(() => organization.createTask(input)));
  ipcMain.handle(IPC_CHANNELS.updateTask, (_event, input) => mutate(() => organization.updateTask(input)));
  ipcMain.handle(IPC_CHANNELS.deleteTask, (_event, input) => mutate(() => organization.deleteTask(input)));
  ipcMain.handle(IPC_CHANNELS.updateTaskStatus, (_event, input) => mutate(() => organization.updateTaskStatus(input.orgId, input.taskId, input.status)));
  ipcMain.handle(IPC_CHANNELS.runTask, async (_event, input) => {
    try {
      await taskExecution.runTask(input);
      notifyDataChanged();
      return ok(snapshot.load());
    } catch (error) {
      notifyDataChanged();
      return fail("task_run_failed", error instanceof Error ? error.message : String(error));
    }
  });
  ipcMain.handle(IPC_CHANNELS.createGoal, (_event, input) => mutate(() => organization.createGoal(input)));
  ipcMain.handle(IPC_CHANNELS.createProject, (_event, input) => mutate(() => organization.createProject(input)));
  ipcMain.handle(IPC_CHANNELS.createWorkspace, (_event, input) => mutate(() => organization.createWorkspace(input)));
  ipcMain.handle(IPC_CHANNELS.createDocument, (_event, input) => mutate(() => documents.create(input)));
  ipcMain.handle(IPC_CHANNELS.updateDocument, (_event, input) => mutate(() => documents.update(input)));
  ipcMain.handle(IPC_CHANNELS.deleteDocument, (_event, input) => mutate(() => documents.delete(input)));
  ipcMain.handle(IPC_CHANNELS.createKnowledgeEntry, (_event, input) => mutate(() => knowledge.create(input)));
  ipcMain.handle(IPC_CHANNELS.deleteKnowledgeEntry, (_event, input) => mutate(() => knowledge.delete(input)));
  ipcMain.handle(IPC_CHANNELS.createAutomationRule, (_event, input) => mutate(() => automation.create(input)));
  ipcMain.handle(IPC_CHANNELS.updateAutomationRule, (_event, input) => mutate(() => automation.update(input)));
  ipcMain.handle(IPC_CHANNELS.deleteAutomationRule, (_event, input) => mutate(() => automation.delete(input)));
  ipcMain.handle(IPC_CHANNELS.createMeeting, (_event, input) => mutate(() => meetingService.create(input)));
  ipcMain.handle(IPC_CHANNELS.deleteMeeting, (_event, input) => mutate(() => meetingService.delete(input)));
  ipcMain.handle(IPC_CHANNELS.createSprint, (_event, input) => mutate(() => sprintService.create(input)));
  ipcMain.handle(IPC_CHANNELS.deleteSprint, (_event, input) => mutate(() => sprintService.delete(input)));
  ipcMain.handle(IPC_CHANNELS.createApproval, (_event, input) => mutate(() => approvals.create(input)));
  ipcMain.handle(IPC_CHANNELS.decideApproval, (_event, input) => mutate(() => approvals.decide(input)));
  ipcMain.handle(IPC_CHANNELS.syncEmployeeIdentity, (_event, input) => mutate(() => identityAccess.syncEmployeeIdentity(input)));
  ipcMain.handle(IPC_CHANNELS.grantRole, (_event, input) => mutate(() => identityAccess.grantRole(input)));
  ipcMain.handle(IPC_CHANNELS.createChatSpace, (_event, input) => mutate(() => chat.createSpace(input)));
  ipcMain.handle(IPC_CHANNELS.sendMessage, (_event, input) => mutate(() => chat.sendMessage(input)));
  ipcMain.handle(IPC_CHANNELS.editMessage, (_event, input) => mutate(() => chat.editMessage(input)));
  ipcMain.handle(IPC_CHANNELS.deleteMessage, (_event, input) => mutate(() => chat.deleteMessage(input)));
  ipcMain.handle(IPC_CHANNELS.markChatSpaceRead, (_event, input) => mutate(() => chat.markSpaceRead(input)));
  ipcMain.handle(IPC_CHANNELS.saveProviderCredential, (_event, input) => mutate(() => providers.saveCredential(input)));
  ipcMain.handle(IPC_CHANNELS.revokeProviderCredential, (_event, input) => mutate(() => providers.revokeCredential(input)));
  ipcMain.handle(IPC_CHANNELS.updateProviderPolicy, (_event, input) => mutate(() => providers.updatePolicy(input)));
  ipcMain.handle(IPC_CHANNELS.checkProviderHealth, async (_event, input) => {
    try {
      await providers.checkHealth(input.orgId, input.providerId);
      notifyDataChanged();
      return ok(snapshot.load());
    } catch (error) {
      return fail("provider_health_failed", error instanceof Error ? error.message : String(error));
    }
  });
  ipcMain.handle(IPC_CHANNELS.listProviderModels, async (_event, input) => {
    try {
      return ok(await providers.listModels(input));
    } catch (error) {
      return fail("provider_models_failed", error instanceof Error ? error.message : String(error));
    }
  });
  ipcMain.handle(IPC_CHANNELS.launchProviderSignIn, (_event, input) => {
    try {
      providers.launchSignInWindow(input);
      return ok(null);
    } catch (error) {
      return fail("provider_sign_in_failed", error instanceof Error ? error.message : String(error));
    }
  });
  ipcMain.handle(IPC_CHANNELS.startProviderOAuth, async (_event, input) => {
    const emit = (event: Record<string, unknown>) =>
      deps.mainWindow.webContents.send(IPC_CHANNELS.rendererEvent, { type: "provider-oauth", providerKey: input.providerKey, ...event });
    try {
      const secret = await providerOAuth.run(
        { providerKey: input.providerKey, enterpriseDomain: input.enterpriseDomain ?? null },
        {
          onAuth: ({ url, instructions }) => {
            const browserUrl = normalizeExternalBrowserUrl(url);
            void shell.openExternal(browserUrl);
            emit({ phase: "authorize", url: browserUrl, instructions });
          },
          onProgress: (message) => emit({ phase: "progress", message }),
        },
      );
      if (input.orgId && input.providerId && input.employeeId) {
        providers.saveCredential({
          orgId: input.orgId,
          providerId: input.providerId,
          secret,
          model: input.model ?? null,
          employeeId: input.employeeId,
        });
        emit({ phase: "active" });
        notifyDataChanged();
        return ok({ secret: null });
      }
      emit({ phase: "active" });
      return ok({ secret });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit({ phase: message === "Login cancelled" ? "cancelled" : "error", message });
      return fail("provider_oauth_failed", message);
    }
  });
  ipcMain.handle(IPC_CHANNELS.cancelProviderOAuth, (_event, input) => {
    providerOAuth.cancel(input.providerKey);
    return ok(null);
  });
  ipcMain.handle(IPC_CHANNELS.openExternalUrl, async (_event, url: string) => {
    try {
      await shell.openExternal(normalizeExternalBrowserUrl(url));
      return ok(null);
    } catch (error) {
      return fail("external_url_failed", error instanceof Error ? error.message : String(error));
    }
  });
  ipcMain.handle(IPC_CHANNELS.createProviderResponse, async (_event, input) => {
    try {
      await providers.createResponse(input);
      notifyDataChanged();
      return ok(snapshot.load());
    } catch (error) {
      return fail("provider_response_failed", error instanceof Error ? error.message : String(error));
    }
  });
  ipcMain.handle(IPC_CHANNELS.streamProviderResponse, async (_event, input) => {
    try {
      await providers.streamResponse(input, (streamEvent) => {
        deps.mainWindow.webContents.send(IPC_CHANNELS.rendererEvent, { type: "provider-response-stream", event: streamEvent });
      });
      notifyDataChanged();
      return ok(snapshot.load());
    } catch (error) {
      return fail("provider_stream_failed", error instanceof Error ? error.message : String(error));
    }
  });
  ipcMain.handle(IPC_CHANNELS.cancelProviderResponse, async (_event, input) => {
    try {
      await providers.cancelResponse(input);
      notifyDataChanged();
      return ok(snapshot.load());
    } catch (error) {
      return fail("provider_cancel_failed", error instanceof Error ? error.message : String(error));
    }
  });
  ipcMain.handle(IPC_CHANNELS.importSkillDirectory, (_event, input) => mutate(() => skills.importDirectory(input)));
  ipcMain.handle(IPC_CHANNELS.syncSkillsFromDisk, (_event, input) => mutate(() => {
    syncSkillsFromDisk(deps.connection.db, skills, input.orgId);
    return null;
  }));
  ipcMain.handle(IPC_CHANNELS.resolveAgentSkills, (_event, input) => mutate(() => skills.resolveRuntimeSnapshot(input)));
  ipcMain.handle(IPC_CHANNELS.runSkillTests, (_event, input) => mutate(() => skills.runTests(input)));
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
      const fileId = await files.importFile(input);
      if (fileId) notifyDataChanged();
      return ok(fileId);
    } catch (error) {
      return fail("file_import_failed", error instanceof Error ? error.message : String(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.openFile, async (_event, input) => {
    try {
      await files.openFile(input);
      return ok(null);
    } catch (error) {
      return fail("file_open_failed", error instanceof Error ? error.message : String(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.pickDirectory, async () => {
    try {
      const result = await dialog.showOpenDialog(deps.mainWindow, { properties: ["openDirectory", "createDirectory"] });
      if (result.canceled || result.filePaths.length === 0) return ok(null);
      return ok(result.filePaths[0]);
    } catch (error) {
      return fail("pick_directory_failed", error instanceof Error ? error.message : String(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.createMigrationReport, (_event, input) => mutate(() => migrations.createReport(input)));
  ipcMain.handle(IPC_CHANNELS.createRollbackSnapshot, (_event, input) => mutate(() => rollback.createSnapshot(input)));
  ipcMain.handle(IPC_CHANNELS.setRollbackSnapshotActive, (_event, input) => mutate(() => rollback.setActive(input)));
  ipcMain.handle(IPC_CHANNELS.resolveMigrationReconciliation, (_event, input) => mutate(() => rollback.resolveReconciliationItem(input)));
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

  const composioConnections = new ComposioConnectionService(deps.connection.db);

  ipcMain.handle(IPC_CHANNELS.listConnectorCatalog, async () => {
    try {
      return ok(await composioConnections.listCatalog());
    } catch (error) {
      return fail("composio_catalog_failed", error instanceof Error ? error.message : String(error));
    }
  });
  ipcMain.handle(IPC_CHANNELS.connectComposioToolkit, async (_event, input) => {
    try {
      const result = await composioConnections.connectToolkit(input.orgId, input.toolkitSlug);
      notifyDataChanged();
      return ok(result);
    } catch (error) {
      return fail("composio_connect_failed", error instanceof Error ? error.message : String(error));
    }
  });
  ipcMain.handle(IPC_CHANNELS.disconnectComposioToolkit, async (_event, input) => {
    try {
      await composioConnections.disconnectToolkit(input.orgId, input.toolkitSlug);
      notifyDataChanged();
      return ok(snapshot.load());
    } catch (error) {
      return fail("composio_disconnect_failed", error instanceof Error ? error.message : String(error));
    }
  });
  ipcMain.handle(IPC_CHANNELS.refreshComposioAccounts, async (_event, input) => {
    try {
      await composioConnections.refreshAccounts(input.orgId);
      notifyDataChanged();
      return ok(snapshot.load());
    } catch (error) {
      return fail("composio_refresh_failed", error instanceof Error ? error.message : String(error));
    }
  });
  ipcMain.handle(IPC_CHANNELS.windowMinimize, () => deps.mainWindow.minimize());
  ipcMain.handle(IPC_CHANNELS.windowMaximize, () => deps.mainWindow.isMaximized() ? deps.mainWindow.unmaximize() : deps.mainWindow.maximize());
  ipcMain.handle(IPC_CHANNELS.windowClose, () => deps.mainWindow.close());
}
