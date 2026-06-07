import type {
  ApprovalState,
  ComplianceExportType,
  ComplianceSubjectType,
  LegalHoldEntityType,
  IdentitySource,
  PrincipalType,
  ProviderDataPolicy,
  ProviderExecutionMode,
  RetentionFreezeScopeType,
  RiskLevel,
  RoleKey,
  SearchEntityType,
  SdlcReviewTargetType,
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

export interface UpdateAgentInput {
  orgId: string;
  agentId: string;
  role: string;
  title: string;
  roleLevel: string;
  department: string;
  budgetCents: number;
  modelProviderId: string | null;
  modelId: string | null;
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

export interface RunTaskInput {
  orgId: string;
  taskId: string;
}

export interface CreateGoalInput {
  orgId: string;
  title: string;
  description: string;
  ownerAgentId: string | null;
}

export interface CreateProjectInput {
  orgId: string;
  goalId: string | null;
  name: string;
  description: string;
  leadAgentId: string | null;
}

export interface CreateWorkspaceInput {
  orgId: string;
  name: string;
  localPath: string;
  projectId: string | null;
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

export interface SyncEmployeeIdentityInput {
  orgId: string;
  employeeId: string;
  source: IdentitySource;
  externalSubject: string;
  email: string | null;
}

export interface GrantRoleInput {
  orgId: string;
  principalType: PrincipalType;
  principalId: string;
  roleKey: RoleKey;
  scopeType: "organization" | "workspace" | "project" | "department";
  scopeId: string;
  grantedByEmployeeId: string;
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

export interface EditMessageInput {
  orgId: string;
  messageId: string;
  actorType: SendMessageInput["senderType"];
  actorId: string | null;
  bodyMd: string;
}

export interface DeleteMessageInput {
  orgId: string;
  messageId: string;
  actorType: SendMessageInput["senderType"];
  actorId: string | null;
}

export interface CreateChatSpaceInput {
  orgId: string;
  spaceType: "company" | "division" | "department" | "project" | "pod" | "ad_hoc" | "direct";
  name: string;
  topic: string;
  visibility: "workspace" | "restricted";
  retentionPolicy?: "standard_365d" | "restricted_365d";
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
  employeeId?: string | null;
}

export interface RevokeProviderCredentialInput {
  orgId: string;
  providerId: string;
}

export interface LaunchProviderSignInInput {
  orgId: string;
  providerId: string;
  employeeId: string;
}

export interface StartProviderOAuthInput {
  providerKey: string;
  enterpriseDomain?: string | null;
  /** Present when connecting an existing org's provider (Settings); absent
   * during onboarding, where the obtained credential is returned to the caller. */
  orgId?: string;
  providerId?: string;
  employeeId?: string;
  model?: string | null;
}

export interface StartProviderOAuthResult {
  /** The obtained credential JSON when no org context was supplied, else null
   * (the credential was already stored). */
  secret: string | null;
}

export interface CancelProviderOAuthInput {
  providerKey: string;
}

export interface CheckProviderHealthInput {
  orgId: string;
  providerId: string;
}

export interface ListProviderModelsInput {
  providerKey: string;
  /** A just-typed/authorized credential (onboarding or the connect-new dialog). */
  secret?: string;
  /** A stored provider whose secret is decrypted server-side (settings refresh). */
  orgId?: string;
  providerId?: string;
}

export interface UpdateProviderPolicyInput {
  orgId: string;
  providerId: string;
  dataPolicy: ProviderDataPolicy;
  backgroundEnabled: boolean;
  monthlyRequestLimit: number;
  workspaceScope: "organization" | "workspace";
}

export interface CreateProviderResponseInput {
  orgId: string;
  providerId: string;
  workspaceId?: string | null;
  prompt: string;
  instructions: string | null;
  executionMode?: ProviderExecutionMode;
}

export type StreamProviderResponseInput = CreateProviderResponseInput;

export interface CancelProviderResponseInput {
  orgId: string;
  requestId: string;
  providerResponseId?: string;
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

export interface RunSkillTestsInput {
  orgId: string;
  revisionId: string;
}

export interface CreateSocialAccountInput {
  orgId: string;
  platform: SocialPlatform;
  handle: string;
  displayName: string;
  createdByEmployeeId: string;
  authorizedEmployeeId: string | null;
}

export interface LaunchSocialLoginInput {
  orgId: string;
  socialAccountId: string;
  employeeId: string;
}

export interface ImportFileInput {
  orgId: string;
}

export interface OpenFileInput {
  orgId: string;
  fileId: string;
}

export interface CreateMigrationReportInput {
  orgId: string;
  sourceDatabasePath: string;
}

export interface CreateRollbackSnapshotInput {
  orgId: string;
  migrationReportId: string;
  createdByEmployeeId: string;
}

export interface SetRollbackSnapshotActiveInput {
  orgId: string;
  snapshotId: string;
  active: boolean;
  employeeId: string;
}

export interface ResolveMigrationReconciliationInput {
  orgId: string;
  reconciliationItemId: string;
  employeeId: string;
}

export interface SearchInput {
  orgId: string;
  employeeId: string;
  query: string;
  entityTypes?: SearchEntityType[];
  limit?: number;
}

export interface CreateComplianceExportInput {
  orgId: string;
  subjectType: ComplianceSubjectType;
  subjectId: string;
  exportType: ComplianceExportType;
  requestedByEmployeeId: string;
}

export interface CreateAuditReplayInput {
  orgId: string;
  threadId: string;
  createdByEmployeeId: string;
}

export interface CreateLegalHoldInput {
  orgId: string;
  entityType: LegalHoldEntityType;
  entityId: string;
  reason: string;
  createdByEmployeeId: string;
}

export interface SetLegalHoldStateInput {
  orgId: string;
  legalHoldId: string;
  active: boolean;
  employeeId: string;
}

export interface CreateRetentionFreezeInput {
  orgId: string;
  scopeType: RetentionFreezeScopeType;
  scopeId: string;
  reason: string;
  createdByEmployeeId: string;
}

export interface SetRetentionFreezeStateInput {
  orgId: string;
  retentionFreezeId: string;
  active: boolean;
  employeeId: string;
}

export interface CreateScheduledPostInput {
  orgId: string;
  socialAccountId: string;
  bodyMd: string;
  scheduledFor: string;
  createdByEmployeeId: string;
}

export interface SetScheduledPostStateInput {
  orgId: string;
  scheduledPostId: string;
  state: "draft" | "scheduled" | "published" | "cancelled";
  employeeId: string;
}

export interface SetFilePinnedInput {
  orgId: string;
  fileId: string;
  pinned: boolean;
}

export interface SetFeatureFlagInput {
  orgId: string;
  flagId: string;
  enabled: boolean;
}

export interface RunChaosDrillInput {
  orgId: string;
  drillId: string;
}

export interface RunSdlcReviewInput {
  orgId: string;
  reviewAgentId: string;
  targetType: SdlcReviewTargetType;
  targetRef: string;
}

export interface RunEvalSuiteInput {
  orgId: string;
  suiteId: string;
}

export interface SetPrBotGateInput {
  orgId: string;
  gateId: string;
  enabled: boolean;
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
