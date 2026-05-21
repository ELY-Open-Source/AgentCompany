import type { DesktopResult } from "./result";
import type { AppSnapshot } from "./domain";
import type {
  BindSkillInput,
  CreateAgentInput,
  CreateApprovalInput,
  CreateOrganizationInput,
  CreateProviderResponseInput,
  CreateSocialAccountInput,
  CreateTaskInput,
  DecideApprovalInput,
  ImportFileInput,
  ImportSkillDirectoryInput,
  LaunchSocialLoginInput,
  ResolveAgentSkillsInput,
  SaveProviderCredentialInput,
  SendMessageInput,
  UpdateTaskStatusInput,
} from "./commands";

export interface RendererEvent {
  type: "snapshot-changed";
}

export interface DesktopApi {
  loadSnapshot(): Promise<DesktopResult<AppSnapshot>>;
  createOrganization(input: CreateOrganizationInput): Promise<DesktopResult<AppSnapshot>>;
  createAgent(input: CreateAgentInput): Promise<DesktopResult<AppSnapshot>>;
  createTask(input: CreateTaskInput): Promise<DesktopResult<AppSnapshot>>;
  updateTaskStatus(input: UpdateTaskStatusInput): Promise<DesktopResult<AppSnapshot>>;
  createApproval(input: CreateApprovalInput): Promise<DesktopResult<AppSnapshot>>;
  decideApproval(input: DecideApprovalInput): Promise<DesktopResult<AppSnapshot>>;
  sendMessage(input: SendMessageInput): Promise<DesktopResult<AppSnapshot>>;
  saveProviderCredential(input: SaveProviderCredentialInput): Promise<DesktopResult<AppSnapshot>>;
  createProviderResponse(input: CreateProviderResponseInput): Promise<DesktopResult<AppSnapshot>>;
  importSkillDirectory(input: ImportSkillDirectoryInput): Promise<DesktopResult<AppSnapshot>>;
  bindSkill(input: BindSkillInput): Promise<DesktopResult<AppSnapshot>>;
  resolveAgentSkills(input: ResolveAgentSkillsInput): Promise<DesktopResult<AppSnapshot>>;
  createSocialAccount(input: CreateSocialAccountInput): Promise<DesktopResult<AppSnapshot>>;
  launchSocialLogin(input: LaunchSocialLoginInput): Promise<DesktopResult<null>>;
  importFile(input: ImportFileInput): Promise<DesktopResult<AppSnapshot>>;
  subscribe(callback: (event: RendererEvent) => void): () => void;
  platform: "win32" | "darwin" | "linux";
  windowMinimize(): Promise<void>;
  windowMaximize(): Promise<void>;
  windowClose(): Promise<void>;
}
