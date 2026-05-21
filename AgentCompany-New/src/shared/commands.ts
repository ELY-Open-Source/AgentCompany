import type {
  ApprovalState,
  RiskLevel,
  SocialPlatform,
  TaskStatus,
} from "./domain";

export interface CreateOrganizationInput {
  organizationName: string;
  mission: string;
  goal: string;
  employeeName: string;
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
}

export interface CreateTaskInput {
  orgId: string;
  title: string;
  description: string;
  status: TaskStatus;
  assigneeAgentId: string | null;
  risk: RiskLevel;
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
}

export interface SaveProviderCredentialInput {
  orgId: string;
  providerId: string;
  secret: string;
  model: string | null;
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

export interface NativeDialogResult {
  canceled: boolean;
  filePaths: string[];
}
