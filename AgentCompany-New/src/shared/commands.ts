import type {
  ApprovalState,
  RiskLevel,
  SocialPlatform,
  TaskPriority,
  TaskStatus,
} from "./domain";

export interface SetActiveOrganizationInput {
  orgId: string;
}

export interface DeleteOrganizationInput {
  orgId: string;
}

export interface CreateOrganizationInput {
  organizationName: string;
  description?: string;
  mission: string;
  goal: string;
  employeeName: string;
  executionMode?: "ai_ceo" | "ai_cofounder";
  autoApproveHires?: boolean;
  reviewDeliverables?: boolean;
}

export interface CreateAgentInput {
  orgId: string;
  name: string;
  role: string;
  department: string;
  modelProviderId: string | null;
  modelId: string | null;
  budgetCents: number;
  managerAgentId: string | null;
  title?: string;
  roleLevel?: string;
  modelStrategy?: string;
  workspaceId?: string | null;
  heartbeatEnabled?: boolean;
  heartbeatIntervalSec?: number;
}

export interface CreateTaskInput {
  orgId: string;
  title: string;
  description: string;
  status: TaskStatus;
  assigneeAgentId: string | null;
  risk: RiskLevel;
  projectId: string | null;
  goalId: string | null;
  workspaceId: string | null;
  priority: TaskPriority;
  requiresFilesystem: boolean;
}

export interface UpdateTaskStatusInput {
  orgId: string;
  taskId: string;
  status: TaskStatus;
}

export interface CreateApprovalInput {
  orgId: string;
  kind: string;
  title: string;
  details: string;
  risk: RiskLevel;
  requestedByType: "employee" | "agent" | "system";
  requestedById: string | null;
}

export interface DecideApprovalInput {
  orgId: string;
  approvalId: string;
  state: Extract<ApprovalState, "approved" | "declined">;
  decidedByEmployeeId: string;
}

export interface SendMessageInput {
  orgId: string;
  spaceId: string;
  threadId: string | null;
  senderType: "employee" | "agent" | "board" | "system";
  senderId: string | null;
  bodyMd: string;
  attachmentFileIds?: string[];
}

export interface CreateChatSpaceInput {
  orgId: string;
  spaceType: "company" | "department" | "project" | "direct";
  name: string;
  topic: string;
  visibility: "workspace" | "restricted";
  memberEmployeeIds?: string[];
  memberAgentIds?: string[];
}

export interface MarkChatSpaceReadInput {
  orgId: string;
  employeeId: string;
  spaceId: string;
}

export interface SaveProviderCredentialInput {
  orgId: string;
  providerId: string;
  secret: string;
  model: string | null;
}

export interface LaunchProviderSignInInput {
  orgId: string;
  providerId: string;
}

export interface CreateProviderResponseInput {
  orgId: string;
  providerId: string;
  prompt: string;
  instructions: string | null;
}

export interface ImportSkillDirectoryInput {
  orgId: string;
  directoryPath: string;
  versionSemver: string;
}

export interface BindSkillInput {
  orgId: string;
  agentId: string;
  skillId: string;
  revisionId: string;
}

export interface ResolveAgentSkillsInput {
  orgId: string;
  agentId: string;
  runId: string;
}

export interface CreateSocialAccountInput {
  orgId: string;
  platform: SocialPlatform;
  handle: string;
  displayName: string;
  authorizedEmployeeId: string | null;
}

export interface LaunchSocialLoginInput {
  socialAccountId: string;
}

export interface ImportFileInput {
  orgId: string;
}

export interface CreateMigrationReportInput {
  orgId: string;
  sourceDatabasePath: string;
}

export interface CreateScheduledPostInput {
  orgId: string;
  socialAccountId: string;
  bodyMd: string;
  scheduledFor: string;
  state: "draft" | "scheduled";
  createdByEmployeeId: string | null;
}

export interface SetScheduledPostStateInput {
  orgId: string;
  scheduledPostId: string;
  state: "draft" | "scheduled" | "published" | "cancelled";
}

export interface SetFilePinnedInput {
  orgId: string;
  fileId: string;
  pinned: boolean;
}

export interface BootstrapOnboardingInput {
  companyName: string;
  companyDescription: string;
  employeeName: string;
  workspacePath: string;
  executionMode: "ai_ceo" | "ai_cofounder";
  autoApproveHires: boolean;
  reviewDeliverables: boolean;
  goalTitle: string;
  goalDescription: string;
  providerKey: string;
  providerSecret: string;
  providerModel: string;
}

export interface BootstrapOnboardingSummary {
  orgId: string;
  employeeId: string;
  ceoAgentId: string;
  workspaceId: string | null;
  goalId: string;
  projectId: string;
  taskId: string;
  runId: string;
  providerId: string;
}

export interface NativeDialogResult {
  canceled: boolean;
  filePaths: string[];
}
