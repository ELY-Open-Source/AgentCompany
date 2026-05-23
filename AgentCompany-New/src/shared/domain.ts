import type { BoardInterventionRecord as BoardInterventionRecordModel, ChatThreadBoardState as ChatThreadBoardStateModel } from "./board-domain";
import type { ComplianceExportRecord, LegalHoldRecord, RetentionFreezeRecord } from "./compliance-domain";
export { BOARD_INTERVENTION_ACTION, BOARD_INTERVENTION_MODE, CHAT_THREAD_BOARD_STATE, type BoardInterventionAction, type BoardInterventionMode, type BoardInterventionRecord, type ChatThreadBoardState } from "./board-domain";
export { COMPLIANCE_EXPORT_STATE, COMPLIANCE_EXPORT_TYPE, type ComplianceExportRecord, type ComplianceExportState, type ComplianceExportType, type ComplianceSubjectType, type LegalHoldEntityType, type LegalHoldRecord, type RetentionFreezeRecord, type RetentionFreezeScopeType } from "./compliance-domain";
export { SEARCH_ENTITY_TYPES, type SearchEntityType, type SearchResultRecord } from "./search-domain";
export const TASK_STATUS = {
  BACKLOG: "backlog",
  IN_PROGRESS: "in_progress",
  REVIEW: "review",
  DONE: "done",
} as const;

export const APPROVAL_STATE = {
  PENDING: "pending",
  APPROVED: "approved",
  DECLINED: "declined",
} as const;

export const RISK_LEVEL = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
} as const;

export const TASK_PRIORITY = {
  LOW: "low",
  NORMAL: "normal",
  HIGH: "high",
} as const;

export const PROVIDER_AUTH_TYPE = {
  API_KEY: "api_key",
  OAUTH_PKCE: "oauth_pkce",
  ACCOUNT_SUBSCRIPTION: "account_subscription",
  CLOUD: "cloud",
} as const;

export const SOCIAL_PLATFORM = {
  X: "x",
  LINKEDIN: "linkedin",
  YOUTUBE: "youtube",
  INSTAGRAM: "instagram",
} as const;

export const PROVIDER_REQUEST_STATE = {
  PENDING: "pending",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
} as const;

export const FILE_SCAN_STATE = {
  APPROVED: "approved",
  BLOCKED: "blocked",
} as const;

export type ValueOf<T> = T[keyof T];
export type TaskStatus = ValueOf<typeof TASK_STATUS>;
export type ApprovalState = ValueOf<typeof APPROVAL_STATE>;
export type RiskLevel = ValueOf<typeof RISK_LEVEL>;
export type TaskPriority = ValueOf<typeof TASK_PRIORITY>;
export type ProviderAuthType = ValueOf<typeof PROVIDER_AUTH_TYPE>;
export type SocialPlatform = ValueOf<typeof SOCIAL_PLATFORM>;
export type ProviderRequestState = ValueOf<typeof PROVIDER_REQUEST_STATE>;
export type FileScanState = ValueOf<typeof FILE_SCAN_STATE>;

export interface OrganizationRecord {
  id: string;
  name: string;
  mission: string;
  goal: string;
  description: string;
  executionMode: string;
  autoApproveHires: boolean;
  reviewDeliverables: boolean;
  createdAt: string;
}

export interface EmployeeRecord {
  id: string;
  orgId: string;
  displayName: string;
  role: string;
  createdAt: string;
}

export interface AgentRecord {
  id: string;
  orgId: string;
  name: string;
  role: string;
  department: string;
  modelProviderId: string | null;
  modelId: string | null;
  budgetCents: number;
  managerAgentId: string | null;
  title: string;
  roleLevel: string;
  modelStrategy: string;
  workspaceId: string | null;
  heartbeatEnabled: boolean;
  heartbeatIntervalSec: number;
  lifecycle: string;
  createdAt: string;
}

export interface TaskRecord {
  id: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceRecord {
  id: string;
  orgId: string;
  name: string;
  localPath: string;
  repoUrl: string;
  repoRef: string;
  projectId: string | null;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GoalRecord {
  id: string;
  orgId: string;
  title: string;
  description: string;
  status: string;
  ownerAgentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRecord {
  id: string;
  orgId: string;
  goalId: string | null;
  name: string;
  description: string;
  leadAgentId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRunRecord {
  id: string;
  orgId: string;
  taskId: string;
  agentId: string | null;
  providerId: string | null;
  trigger: string;
  state: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface ApprovalRecord {
  id: string;
  orgId: string;
  kind: string;
  title: string;
  details: string;
  risk: RiskLevel;
  requestedByType: "employee" | "agent" | "system";
  requestedById: string | null;
  state: ApprovalState;
  decidedByEmployeeId: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface ChatSpaceRecord {
  id: string;
  orgId: string;
  spaceType: string;
  name: string;
  topic: string;
  visibility: string;
  retentionPolicy: string;
  createdAt: string;
}

export interface ChatMessageRecord {
  id: string;
  orgId: string;
  spaceId: string;
  threadId: string | null;
  senderType: "employee" | "agent" | "board" | "system";
  senderId: string | null;
  bodyMd: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface ChatThreadRecord {
  id: string;
  orgId: string;
  spaceId: string;
  rootMessageId: string | null;
  title: string;
  state: string;
  boardState: ChatThreadBoardStateModel;
  controlledByType: "employee" | "agent" | "board" | null;
  controlledById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatAttachmentRecord {
  messageId: string;
  fileId: string;
  transferType: string;
  checksum: string;
  previewKey: string | null;
}

export interface ChatMentionRecord {
  messageId: string;
  targetType: "employee" | "agent" | "board" | "org_group";
  targetId: string;
  offsetStart: number;
  offsetEnd: number;
}

export interface ChatSlashInvocationRecord {
  id: string;
  messageId: string;
  command: string;
  argsJson: string;
  resultRef: string | null;
  createdAt: string;
}

export interface ChatPresenceRecord {
  principalType: string;
  principalId: string;
  status: string;
  statusText: string;
  lastSeenAt: string;
}

export interface ChatReadStateRecord {
  orgId: string;
  employeeId: string;
  spaceId: string;
  lastReadMessageId: string | null;
  lastReadAt: string;
}

export interface FileObjectRecord {
  id: string;
  orgId: string;
  name: string;
  kind: string;
  sizeBytes: number;
  sha256: string;
  storagePath: string;
  ownerType: "employee" | "agent" | "system";
  ownerId: string | null;
  spaceId: string | null;
  pinned: boolean;
  scanState: FileScanState;
  scanLabelsJson: string;
  scannedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface FileAccessGrantRecord {
  id: string;
  orgId: string;
  fileId: string;
  grantedToType: "employee" | "agent" | "board" | "org_group";
  grantedToId: string;
  grantedByType: "employee" | "agent" | "board" | "system";
  grantedById: string | null;
  sourceMessageId: string | null;
  sourceThreadId: string | null;
  accessLevel: "read" | "manage";
  createdAt: string;
}

export interface ScheduledPostRecord {
  id: string;
  orgId: string;
  socialAccountId: string;
  bodyMd: string;
  scheduledFor: string;
  state: "draft" | "scheduled" | "published" | "cancelled";
  approvalId: string | null;
  createdByEmployeeId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderRecord {
  id: string;
  orgId: string;
  providerKey: string;
  label: string;
  authType: ProviderAuthType;
  model: string | null;
  credentialId: string | null;
  enabled: boolean;
  authState: string;
  healthState: string;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface ProviderCatalogModel {
  id: string;
  name: string;
}

export interface ProviderCatalogEntry {
  key: string;
  label: string;
  authType: ProviderAuthType;
  defaultModel: string | null;
  capabilityTags: string[];
  signInUrl: string | null;
  credentialHelp: string;
  models: ProviderCatalogModel[];
}

export interface ProviderRequestRecord {
  id: string;
  orgId: string;
  providerId: string;
  providerKey: string;
  model: string;
  promptSha256: string;
  responseText: string | null;
  rawResponseJson: string | null;
  state: ProviderRequestState;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface SkillDefinitionRecord {
  id: string;
  orgId: string;
  slug: string;
  name: string;
  ownerType: string;
  status: string;
  createdAt: string;
}

export interface SkillRevisionRecord {
  id: string;
  skillId: string;
  versionSemver: string;
  manifestJson: string;
  sourceType: string;
  sourceRef: string;
  publishedAt: string;
  immutableChecksum: string;
}

export interface SkillBindingRecord {
  id: string;
  orgId: string;
  agentId: string;
  skillId: string;
  pinnedRevisionId: string;
  bindingMode: string;
  priority: number;
  enabled: boolean;
}

export interface SkillRuntimeSnapshotRecord {
  id: string;
  agentId: string;
  runId: string;
  compiledPrompt: string;
  toolsManifest: string;
  sourceRevisionIds: string;
  createdAt: string;
}

export interface SocialAccountRecord {
  id: string;
  orgId: string;
  platform: SocialPlatform;
  handle: string;
  displayName: string;
  authorizedEmployeeId: string | null;
  createdAt: string;
}

export interface SocialAccountGrantRecord {
  id: string;
  orgId: string;
  socialAccountId: string;
  employeeId: string;
  role: string;
  scopeJson: string;
  createdAt: string;
}

export interface BrowserActionRecord {
  id: string;
  orgId: string;
  socialAccountId: string;
  actionType: string;
  policyDecision: string;
  evidenceFileId: string | null;
  createdAt: string;
}

export interface AuditEventRecord {
  id: string;
  orgId: string;
  entityType: string;
  entityId: string;
  actorType: string;
  actorId: string | null;
  action: string;
  payloadJson: string;
  createdAt: string;
}

export interface PolicyRuleRecord {
  id: string;
  orgId: string;
  subjectType: string;
  subjectId: string | null;
  action: string;
  effect: string;
  riskCeiling: RiskLevel;
  createdAt: string;
}

export interface MigrationReportRecord {
  id: string;
  orgId: string;
  sourceRef: string;
  reportJson: string;
  createdAt: string;
}

export interface AppSnapshot {
  activeOrgId: string | null;
  organizations: OrganizationRecord[];
  employees: EmployeeRecord[];
  agents: AgentRecord[];
  tasks: TaskRecord[];
  workspaces: WorkspaceRecord[];
  goals: GoalRecord[];
  projects: ProjectRecord[];
  taskRuns: TaskRunRecord[];
  approvals: ApprovalRecord[];
  chatSpaces: ChatSpaceRecord[];
  chatMessages: ChatMessageRecord[];
  chatThreads: ChatThreadRecord[];
  chatAttachments: ChatAttachmentRecord[];
  chatMentions: ChatMentionRecord[];
  chatSlashInvocations: ChatSlashInvocationRecord[];
  boardInterventions: BoardInterventionRecordModel[];
  chatPresence: ChatPresenceRecord[];
  chatReadStates: ChatReadStateRecord[];
  files: FileObjectRecord[];
  fileAccessGrants: FileAccessGrantRecord[];
  scheduledPosts: ScheduledPostRecord[];
  providers: ProviderRecord[];
  providerCatalog: ProviderCatalogEntry[];
  providerRequests: ProviderRequestRecord[];
  skillDefinitions: SkillDefinitionRecord[];
  skillRevisions: SkillRevisionRecord[];
  skillBindings: SkillBindingRecord[];
  skillRuntimeSnapshots: SkillRuntimeSnapshotRecord[];
  socialAccounts: SocialAccountRecord[];
  socialAccountGrants: SocialAccountGrantRecord[];
  browserActions: BrowserActionRecord[];
  policyRules: PolicyRuleRecord[];
  migrationReports: MigrationReportRecord[];
  complianceExports: ComplianceExportRecord[]; legalHolds: LegalHoldRecord[]; retentionFreezes: RetentionFreezeRecord[];
  auditEvents: AuditEventRecord[];
}
