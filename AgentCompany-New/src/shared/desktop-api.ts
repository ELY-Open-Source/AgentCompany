import type { DesktopResult } from "./result";
import type { AppSnapshot } from "./domain";
import type {
  BindSkillInput,
  BootstrapOnboardingInput,
  BootstrapOnboardingSummary,
  CreateAgentInput,
  CreateApprovalInput,
  CreateChatSpaceInput,
  CreateMigrationReportInput,
  MarkChatSpaceReadInput,
  CreateOrganizationInput,
  CreateProviderResponseInput,
  CreateScheduledPostInput,
  CreateSocialAccountInput,
  CreateTaskInput,
  DecideApprovalInput,
  DeleteOrganizationInput,
  ImportFileInput,
  ImportSkillDirectoryInput,
  LaunchProviderSignInInput,
  LaunchSocialLoginInput,
  ResolveAgentSkillsInput,
  SaveProviderCredentialInput,
  SendMessageInput,
  SetActiveOrganizationInput,
  SetFilePinnedInput,
  SetScheduledPostStateInput,
  UpdateTaskStatusInput,
} from "./commands";

export interface RendererEvent {
  type: "snapshot-changed";
}

export interface DesktopApi {
  loadSnapshot(): Promise<DesktopResult<AppSnapshot>>;
  bootstrapOnboarding(input: BootstrapOnboardingInput): Promise<DesktopResult<BootstrapOnboardingSummary>>;
  setActiveOrganization(input: SetActiveOrganizationInput): Promise<DesktopResult<AppSnapshot>>;
  deleteOrganization(input: DeleteOrganizationInput): Promise<DesktopResult<AppSnapshot>>;
  createOrganization(input: CreateOrganizationInput): Promise<DesktopResult<AppSnapshot>>;
  createAgent(input: CreateAgentInput): Promise<DesktopResult<AppSnapshot>>;
  createTask(input: CreateTaskInput): Promise<DesktopResult<AppSnapshot>>;
  updateTaskStatus(input: UpdateTaskStatusInput): Promise<DesktopResult<AppSnapshot>>;
  createApproval(input: CreateApprovalInput): Promise<DesktopResult<AppSnapshot>>;
  decideApproval(input: DecideApprovalInput): Promise<DesktopResult<AppSnapshot>>;
  createChatSpace(input: CreateChatSpaceInput): Promise<DesktopResult<AppSnapshot>>;
  sendMessage(input: SendMessageInput): Promise<DesktopResult<AppSnapshot>>;
  markChatSpaceRead(input: MarkChatSpaceReadInput): Promise<DesktopResult<AppSnapshot>>;
  saveProviderCredential(input: SaveProviderCredentialInput): Promise<DesktopResult<AppSnapshot>>;
  launchProviderSignIn(input: LaunchProviderSignInInput): Promise<DesktopResult<null>>;
  createProviderResponse(input: CreateProviderResponseInput): Promise<DesktopResult<AppSnapshot>>;
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
  subscribe(callback: (event: RendererEvent) => void): () => void;
  platform: "win32" | "darwin" | "linux";
  windowMinimize(): Promise<void>;
  windowMaximize(): Promise<void>;
  windowClose(): Promise<void>;
}
