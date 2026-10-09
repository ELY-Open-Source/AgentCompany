import type { RunCursor, RunHistoryPage, TaskDeleteImpact } from "./domain";
import type { SpaceHistoryPage, ThreadHistory } from "./chat-domain";
import type { RunRequestRecord } from "./provider-runtime-domain";
import type { ApprovalDrift } from "./approval-pin";
import type { DesktopResult } from "./result";
import type { AppSnapshot, SearchPage } from "./domain";
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
  SetGoalDueDateInput,
  SetTaskBlockedInput,
  UpdateOrganizationInput,
  UpdateWorkspaceInput,
  DeleteKnowledgeEntryInput,
  ResumeGoalInput,
  UpdateAutomationRuleInput,
  UpdateDocumentInput,
  UpdateTaskInput,
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
  CreateScheduledPostInput,
  CreateSocialAccountInput,
  CreateTaskInput,
  DecideApprovalInput,
  DeleteMessageInput,
  DeleteOrganizationInput,
  EditMessageInput,
  ImportedFiles,
  ImportFileInput,
  OpenFileInput,
  GrantRoleInput,
  LaunchSocialLoginInput,
  RunTaskInput,
  RevokeProviderCredentialInput,
  SaveProviderCredentialInput,
  SetProviderModelInput,
  ProviderEndpoint,
  OnboardingDraft,
  ProviderDisconnectImpact,
  ConnectComposioToolkitInput,
  ConnectComposioToolkitResult,
  ConnectorCatalogEntry,
  DisconnectComposioToolkitInput,
  GrantConnectorInput,
  RevokeConnectorInput,
  RefreshComposioAccountsInput,
  SearchInput,
  SendMessageInput,
  SetActiveOrganizationInput,
  SetUiPreferencesInput,
  SetFilePinnedInput,
  SetFeatureFlagInput,
  SetLegalHoldStateInput,
  SetRetentionFreezeStateInput,
  SetScheduledPostStateInput,
  StreamProviderResponseInput,
  SyncEmployeeIdentityInput,
  UpdateProviderPolicyInput,
  SetProviderPricesInput,
  UpdateTaskStatusInput,
} from "./commands";
import type { ProviderStreamRendererEvent } from "./provider-request-domain";

export type ProviderOAuthPhase = "authorize" | "progress" | "active" | "error" | "cancelled";

export interface ProviderOAuthEvent {
  type: "provider-oauth";
  providerKey: string;
  phase: ProviderOAuthPhase;
  url?: string;
  /** The device-flow code the user enters at `url`; null when the browser redirect completes the sign-in. */
  userCode?: string | null;
  message?: string;
}

export type RendererEvent =
  /** `version` is the data version the change produced; a snapshot at that version or later already shows it. */
  | { type: "snapshot-changed"; version: number }
  | { type: "provider-response-stream"; event: ProviderStreamRendererEvent }
  | ProviderOAuthEvent;

/** The verdict of a model's agent check. */
export type ModelCheckResult = { passed: true } | { passed: false; detail: string };

export interface DesktopApi {
  loadSnapshot(): Promise<DesktopResult<AppSnapshot>>;
  /** Restarts the app, which a display-language change needs; the user asks for it after seeing what it interrupts. */
  relaunchApp(): Promise<DesktopResult<null>>;
  /** Whether typed input would be lost if the app closed now; closing asks first while it is. */
  reportUnsaved(input: { unsaved: boolean }): Promise<DesktopResult<null>>;
  /** Remembers one piece of where the operator was; null forgets it. */
  saveViewState(input: { key: string; value: unknown }): Promise<DesktopResult<null>>;
  /** Puts text on the system clipboard. */
  copyText(input: { text: string }): Promise<DesktopResult<null>>;
  saveOnboardingDraft(input: { draft: OnboardingDraft | null }): Promise<DesktopResult<null>>;
  completeSetup(input: { orgId: string }): Promise<DesktopResult<AppSnapshot>>;
  /** Every agent session running now, in every company: what a restart interrupts. */
  runningSessionCount(): Promise<DesktopResult<number>>;
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
  setProviderModel(input: SetProviderModelInput): Promise<DesktopResult<AppSnapshot>>;
  /** Null when the provider has no saved cloud or custom-endpoint credential. */
  providerEndpoint(input: { orgId: string; providerId: string }): Promise<DesktopResult<ProviderEndpoint | null>>;
  providerDisconnectImpact(input: { orgId: string; providerId: string }): Promise<DesktopResult<ProviderDisconnectImpact>>;
  revokeProviderCredential(input: RevokeProviderCredentialInput): Promise<DesktopResult<AppSnapshot>>;
  startProviderOAuth(input: StartProviderOAuthInput): Promise<DesktopResult<StartProviderOAuthResult>>;
  cancelProviderOAuth(input: CancelProviderOAuthInput): Promise<DesktopResult<null>>;
  checkProviderHealth(input: CheckProviderHealthInput): Promise<DesktopResult<AppSnapshot>>;
  listProviderModels(input: ListProviderModelsInput): Promise<DesktopResult<ProviderModelEntry[]>>;
  /** Runs the agent check of a model: one turn that must follow system instructions and call a tool. */
  checkProviderModel(input: { orgId: string; providerId: string; model: string }): Promise<DesktopResult<ModelCheckResult>>;
  updateProviderPolicy(input: UpdateProviderPolicyInput): Promise<DesktopResult<AppSnapshot>>;
  setProviderPrices(input: SetProviderPricesInput): Promise<DesktopResult<AppSnapshot>>;
  setGoalAuditor(input: { orgId: string; providerId: string; modelId: string }): Promise<DesktopResult<AppSnapshot>>;
  openExternalUrl(url: string): Promise<DesktopResult<null>>;
  createProviderResponse(input: CreateProviderResponseInput): Promise<DesktopResult<AppSnapshot>>;
  streamProviderResponse(input: StreamProviderResponseInput): Promise<DesktopResult<AppSnapshot>>;
  cancelProviderResponse(input: CancelProviderResponseInput): Promise<DesktopResult<AppSnapshot>>;
  createSocialAccount(input: CreateSocialAccountInput): Promise<DesktopResult<AppSnapshot>>;
  launchSocialLogin(input: LaunchSocialLoginInput): Promise<DesktopResult<null>>;
  createScheduledPost(input: CreateScheduledPostInput): Promise<DesktopResult<AppSnapshot>>;
  setScheduledPostState(input: SetScheduledPostStateInput): Promise<DesktopResult<AppSnapshot>>;
  importFile(input: ImportFileInput): Promise<DesktopResult<ImportedFiles>>;
  openFile(input: OpenFileInput): Promise<DesktopResult<null>>;
  pickDirectory(): Promise<DesktopResult<string | null>>;
  setFilePinned(input: SetFilePinnedInput): Promise<DesktopResult<AppSnapshot>>;
  createMigrationReport(input: CreateMigrationReportInput): Promise<DesktopResult<AppSnapshot>>;
  setFeatureFlag(input: SetFeatureFlagInput): Promise<DesktopResult<AppSnapshot>>;
  createComplianceExport(input: CreateComplianceExportInput): Promise<DesktopResult<AppSnapshot>>;
  createLegalHold(input: CreateLegalHoldInput): Promise<DesktopResult<AppSnapshot>>;
  setLegalHoldState(input: SetLegalHoldStateInput): Promise<DesktopResult<AppSnapshot>>;
  createRetentionFreeze(input: CreateRetentionFreezeInput): Promise<DesktopResult<AppSnapshot>>;
  setRetentionFreezeState(input: SetRetentionFreezeStateInput): Promise<DesktopResult<AppSnapshot>>;
  listConnectorCatalog(): Promise<DesktopResult<ConnectorCatalogEntry[]>>;
  connectComposioToolkit(input: ConnectComposioToolkitInput): Promise<DesktopResult<ConnectComposioToolkitResult>>;
  disconnectComposioToolkit(input: DisconnectComposioToolkitInput): Promise<DesktopResult<AppSnapshot>>;
  refreshComposioAccounts(input: RefreshComposioAccountsInput): Promise<DesktopResult<AppSnapshot>>;
  grantConnector(input: GrantConnectorInput): Promise<DesktopResult<AppSnapshot>>;
  /** Approved deliverables whose content changed or vanished since approval, checked on disk now. */
  approvalDrifts(input: { orgId: string; approvalIds: string[] }): Promise<DesktopResult<Record<string, ApprovalDrift>>>;
  /** Every model call a task run made, in order: turns, goal audits and model checks. */
  runRequests(input: { orgId: string; runId: string }): Promise<DesktopResult<RunRequestRecord[]>>;
  /** One thread in full, beyond the snapshot's recent window. */
  chatThreadHistory(input: { orgId: string; threadId: string }): Promise<DesktopResult<ThreadHistory>>;
  /** The page of a conversation before a loaded message, for history older than the snapshot holds. */
  /** Blocks a task with a reason, or unblocks it with null. */
  setTaskBlocked(input: SetTaskBlockedInput): Promise<DesktopResult<AppSnapshot>>;
  /** What deleting a task would remove, keep and close. */
  taskDeleteImpact(input: { orgId: string; taskId: string }): Promise<DesktopResult<TaskDeleteImpact>>;
  /** Cancels a run that has not started yet. */
  setGoalDueDate(input: SetGoalDueDateInput): Promise<DesktopResult<AppSnapshot>>;
  updateOrganization(input: UpdateOrganizationInput): Promise<DesktopResult<AppSnapshot>>;
  updateWorkspace(input: UpdateWorkspaceInput): Promise<DesktopResult<AppSnapshot>>;
  setPrimaryWorkspace(input: { orgId: string; workspaceId: string }): Promise<DesktopResult<AppSnapshot>>;
  deleteWorkspace(input: { orgId: string; workspaceId: string }): Promise<DesktopResult<AppSnapshot>>;
  cancelQueuedRun(input: { orgId: string; runId: string }): Promise<DesktopResult<AppSnapshot>>;
  /** Runs older than a loaded one, for history beyond the snapshot's recent runs. */
  runHistory(input: { orgId: string; beforeRunId: string | null } & ({ limit: number } | { from: RunCursor })): Promise<DesktopResult<RunHistoryPage>>;
  chatSpaceHistory(input: { orgId: string; spaceId: string; beforeMessageId: string | null } & ({ limit: number } | { fromMessageId: string })): Promise<DesktopResult<SpaceHistoryPage>>;
  revokeConnector(input: RevokeConnectorInput): Promise<DesktopResult<AppSnapshot>>;
  search(input: SearchInput): Promise<DesktopResult<SearchPage>>;
  subscribe(callback: (event: RendererEvent) => void): () => void;
  platform: "win32" | "darwin" | "linux";
  language: "en" | "zh";
  windowMinimize(): Promise<void>;
  windowMaximize(): Promise<void>;
  windowClose(): Promise<void>;
}
