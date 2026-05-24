import type { DesktopResult } from "./result";
import type { AppSnapshot, SearchResultRecord } from "./domain";
import type {
  BindSkillInput,
  BootstrapOnboardingInput,
  BootstrapOnboardingSummary,
  CancelProviderResponseInput,
  CreateAgentInput,
  CreateApprovalInput,
  CreateAuditReplayInput,
  CreateChatSpaceInput,
  CreateComplianceExportInput,
  CreateLegalHoldInput,
  CreateMigrationReportInput,
  CheckProviderHealthInput,
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
  ImportSkillDirectoryInput,
  GrantRoleInput,
  LaunchProviderSignInInput,
  LaunchSocialLoginInput,
  ResolveAgentSkillsInput,
  ResolveMigrationReconciliationInput,
  RunChaosDrillInput,
  RunEvalSuiteInput,
  RunSdlcReviewInput,
  RunTaskInput,
  RevokeProviderCredentialInput,
  SaveProviderCredentialInput,
  SearchInput,
  SendMessageInput,
  SetActiveOrganizationInput,
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

export type RendererEvent =
  | { type: "snapshot-changed" }
  | { type: "provider-response-stream"; event: ProviderStreamRendererEvent };

export interface DesktopApi {
  loadSnapshot(): Promise<DesktopResult<AppSnapshot>>;
  bootstrapOnboarding(input: BootstrapOnboardingInput): Promise<DesktopResult<BootstrapOnboardingSummary>>;
  setActiveOrganization(input: SetActiveOrganizationInput): Promise<DesktopResult<AppSnapshot>>;
  deleteOrganization(input: DeleteOrganizationInput): Promise<DesktopResult<AppSnapshot>>;
  createOrganization(input: CreateOrganizationInput): Promise<DesktopResult<AppSnapshot>>;
  createAgent(input: CreateAgentInput): Promise<DesktopResult<AppSnapshot>>;
  createTask(input: CreateTaskInput): Promise<DesktopResult<AppSnapshot>>;
  updateTaskStatus(input: UpdateTaskStatusInput): Promise<DesktopResult<AppSnapshot>>;
  runTask(input: RunTaskInput): Promise<DesktopResult<AppSnapshot>>;
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
  checkProviderHealth(input: CheckProviderHealthInput): Promise<DesktopResult<AppSnapshot>>;
  updateProviderPolicy(input: UpdateProviderPolicyInput): Promise<DesktopResult<AppSnapshot>>;
  openExternalUrl(url: string): Promise<DesktopResult<null>>;
  createProviderResponse(input: CreateProviderResponseInput): Promise<DesktopResult<AppSnapshot>>;
  streamProviderResponse(input: StreamProviderResponseInput): Promise<DesktopResult<AppSnapshot>>;
  cancelProviderResponse(input: CancelProviderResponseInput): Promise<DesktopResult<AppSnapshot>>;
  importSkillDirectory(input: ImportSkillDirectoryInput): Promise<DesktopResult<AppSnapshot>>;
  bindSkill(input: BindSkillInput): Promise<DesktopResult<AppSnapshot>>;
  resolveAgentSkills(input: ResolveAgentSkillsInput): Promise<DesktopResult<AppSnapshot>>;
  createSocialAccount(input: CreateSocialAccountInput): Promise<DesktopResult<AppSnapshot>>;
  launchSocialLogin(input: LaunchSocialLoginInput): Promise<DesktopResult<null>>;
  createScheduledPost(input: CreateScheduledPostInput): Promise<DesktopResult<AppSnapshot>>;
  setScheduledPostState(input: SetScheduledPostStateInput): Promise<DesktopResult<AppSnapshot>>;
  importFile(input: ImportFileInput): Promise<DesktopResult<AppSnapshot>>;
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
  search(input: SearchInput): Promise<DesktopResult<SearchResultRecord[]>>;
  subscribe(callback: (event: RendererEvent) => void): () => void;
  platform: "win32" | "darwin" | "linux";
  windowMinimize(): Promise<void>;
  windowMaximize(): Promise<void>;
  windowClose(): Promise<void>;
}
