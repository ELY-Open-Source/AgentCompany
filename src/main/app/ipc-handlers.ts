import { createIpcGate } from "./ipc-gate";
import { app, dialog, shell, type BrowserWindow } from "electron";
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
import { ConnectorGrantsService } from "../services/composio/connector-grants";
import { approvalDrifts } from "../services/approval-drift";
import { requestsForRun } from "../services/provider-request-store";
import { setGoalAuditor } from "../services/goal-audit-inputs";
import { IntegrationKeyStore } from "../services/integration-key-store";
import { importStagedSkills, stageBuiltinSkillsLibrary } from "../services/builtin-skills";
import { coalesce } from "./coalesce";
import { normalizeExternalBrowserUrl } from "./external-url";
import { resumeGoal } from "../services/goal-review-service";
import { stopAllRuns, stopRun } from "../services/run-control";

export interface IpcDeps {
  connection: DatabaseConnection;
  mainWindow: BrowserWindow;
  /** The app's own page (dev server URL or built index.html); calls from any other page are refused. */
  appPage: string;
  artifactRoot: string;
  /** Bundled built-in skills source (repo folder in dev, resources when packaged). */
  builtinSkillsSource: string;
  /** Normalized on-disk skill library under the profile directory. */
  builtinSkillsLibrary: string;
}

export function registerIpcHandlers(deps: IpcDeps): void {
  // Every call passes one gate: the caller must be the app's own page, and the input must match its contract.
  const handle = createIpcGate(deps.mainWindow, deps.appPage);
  const snapshot = new SnapshotService(deps.connection.db);
  const organization = new OrganizationService(deps.connection.db);
  const approvals = new ApprovalService(deps.connection.db);
  const chat = new ChatService(deps.connection.db);
  const providers = new ProviderService(deps.connection.db);
  const integrationKeys = new IntegrationKeyStore(deps.connection.db);
  const providerOAuth = new ProviderOAuthService(integrationKeys);
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

  const query = <T>(code: string, read: () => T): DesktopResult<T> => {
    try {
      return ok(read());
    } catch (error) {
      return fail(code, error instanceof Error ? error.message : String(error));
    }
  };

  handle("loadSnapshot", () => {
    try {
      return ok(snapshot.load());
    } catch (error) {
      return fail("snapshot_failed", error instanceof Error ? error.message : String(error));
    }
  });

  handle("bootstrapOnboarding", (input) => {
    try {
      let summary: { orgId: string } | undefined;
      // Staging happens before the transaction (file mirroring), the import
      // inside it: the CEO's kickoff run can be claimed within seconds of
      // commit and must already find the forced humanizer skill.
      const staged = stageBuiltinSkillsLibrary(deps.builtinSkillsSource, deps.builtinSkillsLibrary);
      deps.connection.transaction(() => {
        summary = onboarding.bootstrap(input);
        const report = importStagedSkills(skills, summary.orgId, staged);
        if (report.failures.length > 0) {
          console.warn(`[skills] onboarding import failures (${report.failures.length}): ${report.failures.slice(0, 3).join("; ")}`);
        }
      });
      notifyDataChanged();
      return ok(summary);
    } catch (error) {
      return fail("onboarding_failed", error instanceof Error ? error.message : String(error));
    }
  });

  handle("createOrganization", (input) => mutate(() => organization.createOrganization(input)));
  handle("setActiveOrganization", (input) => mutate(() => organization.setActiveOrganization(input.orgId)));
  handle("setUiPreferences", (input) => {
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
  handle("deleteOrganization", (input) => mutate(() => organization.deleteOrganization(input.orgId)));
  handle("createAgent", (input) => mutate(() => organization.createAgent(input)));
  handle("updateAgent", (input) => mutate(() => organization.updateAgent(input)));
  handle("updateEmployeeProfile", (input) => mutate(() => organization.updateEmployeeProfile(input)));
  handle("setAutonomousPaused", (input) => mutate(() => {
    organization.setAutonomousPaused(Boolean(input.paused));
    // Pausing also stops the sessions already running, not just future scheduling.
    if (input.paused) stopAllRuns();
  }));
  handle("stopRun", (input) => mutate(() => {
    if (!stopRun(input.runId)) throw new Error("That run is not running anymore.");
  }));
  handle("setIntegrationKey", (input) => mutate(() => integrationKeys.write(input.name, input.value)));
  handle("clearIntegrationKey", (input) => mutate(() => integrationKeys.clear(input.name)));
  handle("createTask", (input) => mutate(() => organization.createTask(input)));
  handle("updateTask", (input) => mutate(() => organization.updateTask(input)));
  handle("deleteTask", (input) => mutate(() => organization.deleteTask(input)));
  handle("updateTaskStatus", (input) => mutate(() => organization.updateTaskStatus(input.orgId, input.taskId, input.status)));
  handle("runTask", async (input) => {
    try {
      await taskExecution.runTask(input);
      notifyDataChanged();
      return ok(snapshot.load());
    } catch (error) {
      notifyDataChanged();
      return fail("task_run_failed", error instanceof Error ? error.message : String(error));
    }
  });
  handle("createGoal", (input) => mutate(() => organization.createGoal(input)));
  handle("createProject", (input) => mutate(() => organization.createProject(input)));
  handle("createWorkspace", (input) => mutate(() => organization.createWorkspace(input)));
  handle("createDocument", (input) => mutate(() => documents.create(input)));
  handle("updateDocument", (input) => mutate(() => documents.update(input)));
  handle("deleteDocument", (input) => mutate(() => documents.delete(input)));
  handle("createKnowledgeEntry", (input) => mutate(() => knowledge.create(input)));
  handle("deleteKnowledgeEntry", (input) => mutate(() => knowledge.delete(input)));
  handle("resumeGoal", (input) => mutate(() => resumeGoal(deps.connection.db, organization, input.orgId, input.goalId)));
  handle("updateKnowledgeEntry", (input) => mutate(() => knowledge.update(input)));
  handle("listDocumentVersions", (input) => query("document_versions_failed", () =>
    documents.versions(input.orgId, input.documentId).map((v) => ({
      version: v.version, title: v.title, content: v.content, status: v.status,
      changedByType: v.changed_by_type, changedById: v.changed_by_id, reason: v.reason, createdAt: v.created_at,
    }))));
  handle("listKnowledgeRevisions", (input) => query("knowledge_revisions_failed", () =>
    knowledge.revisions(input.orgId, input.entryId).map((r) => ({
      revision: r.revision, topic: r.topic, category: r.category, content: r.content, importance: r.importance,
      changedByType: r.changed_by_type, changedById: r.changed_by_id, reason: r.reason, createdAt: r.created_at,
    }))));
  handle("createAutomationRule", (input) => mutate(() => automation.create(input)));
  handle("updateAutomationRule", (input) => mutate(() => automation.update(input)));
  handle("deleteAutomationRule", (input) => mutate(() => automation.delete(input)));
  handle("createMeeting", (input) => mutate(() => meetingService.create(input)));
  handle("deleteMeeting", (input) => mutate(() => meetingService.delete(input)));
  handle("createSprint", (input) => mutate(() => sprintService.create(input)));
  handle("deleteSprint", (input) => mutate(() => sprintService.delete(input)));
  handle("createApproval", (input) => mutate(() => approvals.create(input)));
  handle("decideApproval", (input) => mutate(() => approvals.decide(input)));
  handle("syncEmployeeIdentity", (input) => mutate(() => identityAccess.syncEmployeeIdentity(input)));
  handle("grantRole", (input) => mutate(() => identityAccess.grantRole(input)));
  handle("createChatSpace", (input) => mutate(() => chat.createSpace(input)));
  handle("sendMessage", (input) => mutate(() => chat.sendMessage(input)));
  handle("editMessage", (input) => mutate(() => chat.editMessage(input)));
  handle("deleteMessage", (input) => mutate(() => chat.deleteMessage(input)));
  handle("markChatSpaceRead", (input) => mutate(() => chat.markSpaceRead(input)));
  handle("saveProviderCredential", (input) => mutate(() => providers.saveCredential(input)));
  handle("revokeProviderCredential", async (input) => {
    try {
      await providers.revokeCredential(input);
      notifyDataChanged();
      return ok(snapshot.load());
    } catch (error) {
      // The local disconnect has happened even when the provider refused the revocation.
      notifyDataChanged();
      return fail("provider_revoke_failed", error instanceof Error ? error.message : String(error));
    }
  });
  handle("updateProviderPolicy", (input) => mutate(() => providers.updatePolicy(input)));
  handle("setProviderPrices", (input) => mutate(() => providers.setPrices(input)));
  handle("setGoalAuditor", (input) => mutate(() => setGoalAuditor(deps.connection.db, input)));
  handle("checkProviderHealth", async (input) => {
    try {
      await providers.checkHealth(input.orgId, input.providerId);
      notifyDataChanged();
      return ok(snapshot.load());
    } catch (error) {
      return fail("provider_health_failed", error instanceof Error ? error.message : String(error));
    }
  });
  handle("listProviderModels", async (input) => {
    try {
      return ok(await providers.listModels(input));
    } catch (error) {
      return fail("provider_models_failed", error instanceof Error ? error.message : String(error));
    }
  });
  handle("checkProviderModel", async (input) => {
    try {
      return ok(await providers.checkModel(input));
    } catch (error) {
      return fail("provider_model_check_failed", error instanceof Error ? error.message : String(error));
    }
  });
  handle("startProviderOAuth", async (input) => {
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
  handle("cancelProviderOAuth", (input) => {
    providerOAuth.cancel(input.providerKey);
    return ok(null);
  });
  handle("openExternalUrl", async (url) => {
    try {
      await shell.openExternal(normalizeExternalBrowserUrl(url));
      return ok(null);
    } catch (error) {
      return fail("external_url_failed", error instanceof Error ? error.message : String(error));
    }
  });
  handle("createProviderResponse", async (input) => {
    try {
      await providers.createResponse(input);
      notifyDataChanged();
      return ok(snapshot.load());
    } catch (error) {
      return fail("provider_response_failed", error instanceof Error ? error.message : String(error));
    }
  });
  handle("streamProviderResponse", async (input) => {
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
  handle("cancelProviderResponse", async (input) => {
    try {
      await providers.cancelResponse(input);
      notifyDataChanged();
      return ok(snapshot.load());
    } catch (error) {
      return fail("provider_cancel_failed", error instanceof Error ? error.message : String(error));
    }
  });
  handle("createSocialAccount", (input) => mutate(() => social.createAccount(input)));
  handle("createScheduledPost", (input) => mutate(() => social.createScheduledPost(input)));
  handle("setScheduledPostState", (input) => mutate(() => social.setScheduledPostState(input)));
  handle("setFilePinned", (input) => mutate(() => files.setPinned(input.orgId, input.fileId, input.pinned)));

  handle("launchSocialLogin", (input) => {
    try {
      social.launchLoginWindow(input);
      return ok(null);
    } catch (error) {
      return fail("social_login_failed", error instanceof Error ? error.message : String(error));
    }
  });

  handle("importFile", async (input) => {
    try {
      const fileId = await files.importFile(input);
      if (fileId) notifyDataChanged();
      return ok(fileId);
    } catch (error) {
      return fail("file_import_failed", error instanceof Error ? error.message : String(error));
    }
  });

  handle("openFile", async (input) => {
    try {
      await files.openFile(input);
      return ok(null);
    } catch (error) {
      return fail("file_open_failed", error instanceof Error ? error.message : String(error));
    }
  });

  handle("pickDirectory", async () => {
    try {
      const result = await dialog.showOpenDialog(deps.mainWindow, { properties: ["openDirectory", "createDirectory"] });
      if (result.canceled || result.filePaths.length === 0) return ok(null);
      return ok(result.filePaths[0]);
    } catch (error) {
      return fail("pick_directory_failed", error instanceof Error ? error.message : String(error));
    }
  });

  handle("createMigrationReport", (input) => mutate(() => migrations.createReport(input)));
  handle("createRollbackSnapshot", (input) => mutate(() => rollback.createSnapshot(input)));
  handle("setRollbackSnapshotActive", (input) => mutate(() => rollback.setActive(input)));
  handle("resolveMigrationReconciliation", (input) => mutate(() => rollback.resolveReconciliationItem(input)));
  handle("setFeatureFlag", (input) => mutate(() => operations.setFeatureFlag(input)));
  handle("runChaosDrill", (input) => mutate(() => operations.runChaosDrill(input)));
  handle("setPrBotGate", (input) => mutate(() => sdlc.setPrBotGate(input)));
  handle("createComplianceExport", (input) => mutate(() => compliance.createExport(input)));
  handle("createAuditReplay", (input) => mutate(() => audit.createThreadReplay(input)));
  handle("createLegalHold", (input) => mutate(() => compliance.createLegalHold(input)));
  handle("setLegalHoldState", (input) => mutate(() => compliance.setLegalHoldState(input)));
  handle("createRetentionFreeze", (input) => mutate(() => compliance.createRetentionFreeze(input)));
  handle("setRetentionFreezeState", (input) => mutate(() => compliance.setRetentionFreezeState(input)));
  handle("search", (input) => {
    try {
      return ok(search.search(input));
    } catch (error) {
      return fail("search_failed", error instanceof Error ? error.message : String(error));
    }
  });

  const composioConnections = new ComposioConnectionService(deps.connection.db, integrationKeys);

  handle("listConnectorCatalog", async () => {
    try {
      return ok(await composioConnections.listCatalog());
    } catch (error) {
      return fail("composio_catalog_failed", error instanceof Error ? error.message : String(error));
    }
  });
  handle("connectComposioToolkit", async (input) => {
    try {
      return ok(await composioConnections.connectToolkit(input.orgId, input.toolkitSlug, input.label));
    } catch (error) {
      return fail("composio_connect_failed", error instanceof Error ? error.message : String(error));
    } finally {
      // A connection change that failed partway may still have written; the page reloads either way.
      notifyDataChanged();
    }
  });
  handle("disconnectComposioToolkit", async (input) => {
    try {
      await composioConnections.disconnectToolkit(input.orgId, input.toolkitSlug, input.label);
      return ok(snapshot.load());
    } catch (error) {
      return fail("composio_disconnect_failed", error instanceof Error ? error.message : String(error));
    } finally {
      notifyDataChanged();
    }
  });
  handle("grantConnector", (input) => mutate(() => new ConnectorGrantsService(deps.connection.db).grantFromBoard(input)));
  handle("runRequests", (input) => ok(requestsForRun(deps.connection.db, input.orgId, input.runId)));
  handle("approvalDrifts", (input) => {
    try {
      return ok(approvalDrifts(deps.connection.db, input.orgId));
    } catch (error) {
      return fail("approval_drift_failed", error instanceof Error ? error.message : String(error));
    }
  });
  handle("revokeConnector", (input) => mutate(() => new ConnectorGrantsService(deps.connection.db).revoke(input)));
  handle("refreshComposioAccounts", async (input) => {
    try {
      await composioConnections.refreshAccounts(input.orgId);
      return ok(snapshot.load());
    } catch (error) {
      return fail("composio_refresh_failed", error instanceof Error ? error.message : String(error));
    } finally {
      notifyDataChanged();
    }
  });
  handle("windowMinimize", () => deps.mainWindow.minimize());
  handle("windowMaximize", () => deps.mainWindow.isMaximized() ? deps.mainWindow.unmaximize() : deps.mainWindow.maximize());
  handle("windowClose", () => deps.mainWindow.close());
}
