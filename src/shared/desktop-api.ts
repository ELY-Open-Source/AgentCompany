import type { DesktopResult } from "./result";
import type { AppSnapshot, SearchResultRecord } from "./domain";
import type { ProviderModelEntry } from "./provider-models";
import type {
  BootstrapOnboardingInput,
  BootstrapOnboardingSummary,
  CancelProviderResponseInput,
  CreateAgentInput,
  SetAutonomousPausedInput,
  StopRunInput,
  SetIntegrationKeyInput,
  ClearIntegrationKeyInput,
  UpdateAgentInput,
  UpdateEmployeeProfileInput,
  CreateApprovalInput,
  CreateAutomationRuleInput,
  CreateDocumentInput,
  CreateGoalInput,
  CreateMeetingInput,
  CreateSprintInput,
  DeleteMeetingInput,
  DeleteSprintInput,
  CreateKnowledgeEntryInput,
  UpdateKnowledgeEntryInput,
  DocumentVersionRecord,
  KnowledgeRevisionRecord,
  ListDocumentVersionsInput,
  ListKnowledgeRevisionsInput,
  CreateProjectInput,
  CreateWorkspaceInput,
  DeleteAutomationRuleInput,
  DeleteDocumentInput,
  DeleteTaskInput,
  DeleteKnowledgeEntryInput,
  ResumeGoalInput,
  UpdateAutomationRuleInput,
  UpdateDocumentInput,
  UpdateTaskInput,
  CreateAuditReplayInput,
  CreateChatSpaceInput,
  CreateComplianceExportInput,
  CreateLegalHoldInput,
  CreateMigrationReportInput,
  CheckProviderHealthInput,
  ListProviderModelsInput,
  StartProviderOAuthInput,
  StartProviderOAuthResult,
  CancelProviderOAuthInput,
  MarkChatSpaceReadInput,
  CreateOrganizationInput,
  CreateProviderResponseInput,
  CreateRetentionFreezeInput,
  CreateRollbackSnapshotInput,
  CreateScheduledPostInput,
  CreateSocialAccountInput,
  CreateTaskInput,
  DecideApprovalInput,
  DeleteMessageInput,
  DeleteOrganizationInput,
  EditMessageInput,
  ImportFileInput,
  OpenFileInput,
  GrantRoleInput,
  LaunchProviderSignInInput,
  LaunchSocialLoginInput,
  ResolveMigrationReconciliationInput,
  RunChaosDrillInput,
  RunEvalSuiteInput,
  RunSdlcReviewInput,
  RunTaskInput,
  RevokeProviderCredentialInput,
  SaveProviderCredentialInput,
  ConnectComposioToolkitInput,
  ConnectComposioToolkitResult,
  ConnectorCatalogEntry,
  DisconnectComposioToolkitInput,
  RefreshComposioAccountsInput,
  SearchInput,
  SendMessageInput,
  SetActiveOrganizationInput,
  SetUiPreferencesInput,
  SetFilePinnedInput,
  SetFeatureFlagInput,
  SetLegalHoldStateInput,
  SetPrBotGateInput,
  SetRollbackSnapshotActiveInput,
  SetRetentionFreezeStateInput,
  SetScheduledPostStateInput,
  StreamProviderResponseInput,
  SyncEmployeeIdentityInput,
  UpdateProviderPolicyInput,
  UpdateTaskStatusInput,
} from "./commands";
import type { ProviderStreamRendererEvent } from "./provider-request-domain";

export type ProviderOAuthPhase = "authorize" | "progress" | "active" | "error" | "cancelled";

export interface ProviderOAuthEvent {
  type: "provider-oauth";
  providerKey: string;
  phase: ProviderOAuthPhase;
  url?: string;
  instructions?: string;
  message?: string;
}

export type RendererEvent =
  | { type: "snapshot-changed" }
  | { type: "provider-response-stream"; event: ProviderStreamRendererEvent }
  | ProviderOAuthEvent;

export interface DesktopApi {
  loadSnapshot(): Promise<DesktopResult<AppSnapshot>>;
  bootstrapOnboarding(input: BootstrapOnboardingInput): Promise<DesktopResult<BootstrapOnboardingSummary>>;
  setActiveOrganization(input: SetActiveOrganizationInput): Promise<DesktopResult<AppSnapshot>>;
  setUiPreferences(input: SetUiPreferencesInput): Promise<DesktopResult<AppSnapshot>>;
  deleteOrganization(input: DeleteOrganizationInput): Promise<DesktopResult<AppSnapshot>>;
  createOrganization(input: CreateOrganizationInput): Promise<DesktopResult<AppSnapshot>>;
  createAgent(input: CreateAgentInput): Promise<DesktopResult<AppSnapshot>>;
  updateAgent(input: UpdateAgentInput): Promise<DesktopResult<AppSnapshot>>;
  updateEmployeeProfile(input: UpdateEmployeeProfileInput): Promise<DesktopResult<AppSnapshot>>;
  setAutonomousPaused(input: SetAutonomousPausedInput): Promise<DesktopResult<AppSnapshot>>;
  stopRun(input: StopRunInput): Promise<DesktopResult<AppSnapshot>>;
  setIntegrationKey(input: SetIntegrationKeyInput): Promise<DesktopResult<AppSnapshot>>;
  clearIntegrationKey(input: ClearIntegrationKeyInput): Promise<DesktopResult<AppSnapshot>>;
  createTask(input: CreateTaskInput): Promise<DesktopResult<AppSnapshot>>;
  updateTask(input: UpdateTaskInput): Promise<DesktopResult<AppSnapshot>>;
  deleteTask(input: DeleteTaskInput): Promise<DesktopResult<AppSnapshot>>;
  updateTaskStatus(input: UpdateTaskStatusInput): Promise<DesktopResult<AppSnapshot>>;
  runTask(input: RunTaskInput): Promise<DesktopResult<AppSnapshot>>;
  createGoal(input: CreateGoalInput): Promise<DesktopResult<AppSnapshot>>;
  createProject(input: CreateProjectInput): Promise<DesktopResult<AppSnapshot>>;
  createWorkspace(input: CreateWorkspaceInput): Promise<DesktopResult<AppSnapshot>>;
  createDocument(input: CreateDocumentInput): Promise<DesktopResult<AppSnapshot>>;
  updateDocument(input: UpdateDocumentInput): Promise<DesktopResult<AppSnapshot>>;
  deleteDocument(input: DeleteDocumentInput): Promise<DesktopResult<AppSnapshot>>;
  createKnowledgeEntry(input: CreateKnowledgeEntryInput): Promise<DesktopResult<AppSnapshot>>;
  deleteKnowledgeEntry(input: DeleteKnowledgeEntryInput): Promise<DesktopResult<AppSnapshot>>;
  resumeGoal(input: ResumeGoalInput): Promise<DesktopResult<AppSnapshot>>;
  updateKnowledgeEntry(input: UpdateKnowledgeEntryInput): Promise<DesktopResult<AppSnapshot>>;
  listDocumentVersions(input: ListDocumentVersionsInput): Promise<DesktopResult<DocumentVersionRecord[]>>;
  listKnowledgeRevisions(input: ListKnowledgeRevisionsInput): Promise<DesktopResult<KnowledgeRevisionRecord[]>>;
  createAutomationRule(input: CreateAutomationRuleInput): Promise<DesktopResult<AppSnapshot>>;
  updateAutomationRule(input: UpdateAutomationRuleInput): Promise<DesktopResult<AppSnapshot>>;
  deleteAutomationRule(input: DeleteAutomationRuleInput): Promise<DesktopResult<AppSnapshot>>;
  createMeeting(input: CreateMeetingInput): Promise<DesktopResult<AppSnapshot>>;
  deleteMeeting(input: DeleteMeetingInput): Promise<DesktopResult<AppSnapshot>>;
  createSprint(input: CreateSprintInput): Promise<DesktopResult<AppSnapshot>>;
  deleteSprint(input: DeleteSprintInput): Promise<DesktopResult<AppSnapshot>>;
  createApproval(input: CreateApprovalInput): Promise<DesktopResult<AppSnapshot>>;
  decideApproval(input: DecideApprovalInput): Promise<DesktopResult<AppSnapshot>>;
  syncEmployeeIdentity(input: SyncEmployeeIdentityInput): Promise<DesktopResult<AppSnapshot>>;
  grantRole(input: GrantRoleInput): Promise<DesktopResult<AppSnapshot>>;
  createChatSpace(input: CreateChatSpaceInput): Promise<DesktopResult<AppSnapshot>>;
  sendMessage(input: SendMessageInput): Promise<DesktopResult<AppSnapshot>>;
  editMessage(input: EditMessageInput): Promise<DesktopResult<AppSnapshot>>;
  deleteMessage(input: DeleteMessageInput): Promise<DesktopResult<AppSnapshot>>;
  markChatSpaceRead(input: MarkChatSpaceReadInput): Promise<DesktopResult<AppSnapshot>>;
  saveProviderCredential(input: SaveProviderCredentialInput): Promise<DesktopResult<AppSnapshot>>;
  revokeProviderCredential(input: RevokeProviderCredentialInput): Promise<DesktopResult<AppSnapshot>>;
  launchProviderSignIn(input: LaunchProviderSignInInput): Promise<DesktopResult<null>>;
  startProviderOAuth(input: StartProviderOAuthInput): Promise<DesktopResult<StartProviderOAuthResult>>;
  cancelProviderOAuth(input: CancelProviderOAuthInput): Promise<DesktopResult<null>>;
  checkProviderHealth(input: CheckProviderHealthInput): Promise<DesktopResult<AppSnapshot>>;
  listProviderModels(input: ListProviderModelsInput): Promise<DesktopResult<ProviderModelEntry[]>>;
  updateProviderPolicy(input: UpdateProviderPolicyInput): Promise<DesktopResult<AppSnapshot>>;
  openExternalUrl(url: string): Promise<DesktopResult<null>>;
  createProviderResponse(input: CreateProviderResponseInput): Promise<DesktopResult<AppSnapshot>>;
  streamProviderResponse(input: StreamProviderResponseInput): Promise<DesktopResult<AppSnapshot>>;
  cancelProviderResponse(input: CancelProviderResponseInput): Promise<DesktopResult<AppSnapshot>>;
  createSocialAccount(input: CreateSocialAccountInput): Promise<DesktopResult<AppSnapshot>>;
  launchSocialLogin(input: LaunchSocialLoginInput): Promise<DesktopResult<null>>;
  createScheduledPost(input: CreateScheduledPostInput): Promise<DesktopResult<AppSnapshot>>;
  setScheduledPostState(input: SetScheduledPostStateInput): Promise<DesktopResult<AppSnapshot>>;
  importFile(input: ImportFileInput): Promise<DesktopResult<string | null>>;
  openFile(input: OpenFileInput): Promise<DesktopResult<null>>;
  pickDirectory(): Promise<DesktopResult<string | null>>;
  setFilePinned(input: SetFilePinnedInput): Promise<DesktopResult<AppSnapshot>>;
  createMigrationReport(input: CreateMigrationReportInput): Promise<DesktopResult<AppSnapshot>>;
  createRollbackSnapshot(input: CreateRollbackSnapshotInput): Promise<DesktopResult<AppSnapshot>>;
  setRollbackSnapshotActive(input: SetRollbackSnapshotActiveInput): Promise<DesktopResult<AppSnapshot>>;
  resolveMigrationReconciliation(input: ResolveMigrationReconciliationInput): Promise<DesktopResult<AppSnapshot>>;
  setFeatureFlag(input: SetFeatureFlagInput): Promise<DesktopResult<AppSnapshot>>;
  runChaosDrill(input: RunChaosDrillInput): Promise<DesktopResult<AppSnapshot>>;
  runSdlcReview(input: RunSdlcReviewInput): Promise<DesktopResult<AppSnapshot>>;
  runEvalSuite(input: RunEvalSuiteInput): Promise<DesktopResult<AppSnapshot>>;
  setPrBotGate(input: SetPrBotGateInput): Promise<DesktopResult<AppSnapshot>>;
  createComplianceExport(input: CreateComplianceExportInput): Promise<DesktopResult<AppSnapshot>>;
  createAuditReplay(input: CreateAuditReplayInput): Promise<DesktopResult<AppSnapshot>>;
  createLegalHold(input: CreateLegalHoldInput): Promise<DesktopResult<AppSnapshot>>;
  setLegalHoldState(input: SetLegalHoldStateInput): Promise<DesktopResult<AppSnapshot>>;
  createRetentionFreeze(input: CreateRetentionFreezeInput): Promise<DesktopResult<AppSnapshot>>;
  setRetentionFreezeState(input: SetRetentionFreezeStateInput): Promise<DesktopResult<AppSnapshot>>;
  listConnectorCatalog(): Promise<DesktopResult<ConnectorCatalogEntry[]>>;
  connectComposioToolkit(input: ConnectComposioToolkitInput): Promise<DesktopResult<ConnectComposioToolkitResult>>;
  disconnectComposioToolkit(input: DisconnectComposioToolkitInput): Promise<DesktopResult<AppSnapshot>>;
  refreshComposioAccounts(input: RefreshComposioAccountsInput): Promise<DesktopResult<AppSnapshot>>;
  search(input: SearchInput): Promise<DesktopResult<SearchResultRecord[]>>;
  subscribe(callback: (event: RendererEvent) => void): () => void;
  platform: "win32" | "darwin" | "linux";
  language: "en" | "zh";
  windowMinimize(): Promise<void>;
  windowMaximize(): Promise<void>;
  windowClose(): Promise<void>;
}
