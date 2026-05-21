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

export type ValueOf<T> = T[keyof T];
export type TaskStatus = ValueOf<typeof TASK_STATUS>;
export type ApprovalState = ValueOf<typeof APPROVAL_STATE>;
export type RiskLevel = ValueOf<typeof RISK_LEVEL>;
export type ProviderAuthType = ValueOf<typeof PROVIDER_AUTH_TYPE>;
export type SocialPlatform = ValueOf<typeof SOCIAL_PLATFORM>;
export type ProviderRequestState = ValueOf<typeof PROVIDER_REQUEST_STATE>;

export interface OrganizationRecord {
  id: string;
  name: string;
  mission: string;
  goal: string;
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
  createdAt: string;
  updatedAt: string;
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

export interface ChatPresenceRecord {
  principalType: string;
  principalId: string;
  status: string;
  statusText: string;
  lastSeenAt: string;
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
  createdAt: string;
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
  createdAt: string;
}

export interface ProviderCatalogEntry {
  key: string;
  label: string;
  authType: ProviderAuthType;
  defaultModel: string | null;
  capabilityTags: string[];
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
  approvals: ApprovalRecord[];
  chatSpaces: ChatSpaceRecord[];
  chatMessages: ChatMessageRecord[];
  chatThreads: ChatThreadRecord[];
  chatAttachments: ChatAttachmentRecord[];
  chatPresence: ChatPresenceRecord[];
  files: FileObjectRecord[];
  providers: ProviderRecord[];
  providerCatalog: ProviderCatalogEntry[];
  providerRequests: ProviderRequestRecord[];
  skillDefinitions: SkillDefinitionRecord[];
  skillRevisions: SkillRevisionRecord[];
  skillBindings: SkillBindingRecord[];
  skillRuntimeSnapshots: SkillRuntimeSnapshotRecord[];
  socialAccounts: SocialAccountRecord[];
  policyRules: PolicyRuleRecord[];
  migrationReports: MigrationReportRecord[];
  auditEvents: AuditEventRecord[];
}
