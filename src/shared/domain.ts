import type { ProviderDataPolicy } from "./provider-policy-domain";
export { BOARD_INTERVENTION_ACTION, BOARD_INTERVENTION_MODE, CHAT_THREAD_BOARD_STATE, type BoardInterventionAction, type BoardInterventionMode, type BoardInterventionRecord, type ChatThreadBoardState } from "./board-domain";
export type { ChatSpaceRecord, ChatMessageRecord, ChatMembershipRecord, ChatThreadRecord, ChatAttachmentRecord, ChatMentionRecord, ChatSlashInvocationRecord, ChatPresenceRecord, ChatReadStateRecord } from "./chat-domain";
export type { AuditReplayRunRecord } from "./audit-domain";
export { COMPLIANCE_EXPORT_STATE, COMPLIANCE_EXPORT_TYPE, type ComplianceExportRecord, type ComplianceExportState, type ComplianceExportType, type ComplianceSubjectType, type LegalHoldEntityType, type LegalHoldRecord, type RetentionFreezeRecord, type RetentionFreezeScopeType } from "./compliance-domain";
export { ACCESS_DECISION, IDENTITY_SOURCE, ROLE_KEY, type AccessDecision, type AccessDecisionRecord, type EmployeeIdentityRecord, type IdentitySource, type PrincipalType, type RoleGrantRecord, type RoleKey, type ServiceIdentityRecord } from "./identity-domain";
export { ROUTE_TO_TYPE, type ApprovalAssignmentRecord, type ApprovalRoutingRuleRecord, type HiringPolicyRecord, type OrgDepartmentRecord, type RouteToType } from "./org-governance-domain";
export { CHAOS_DRILL_SCENARIO, CHAOS_DRILL_STATE, FEATURE_FLAG_KEY, SLO_SIGNAL_KEY, type ChaosDrillRecord, type ChaosDrillRunRecord, type ChaosDrillScenario, type ChaosDrillState, type FeatureFlagKey, type FeatureFlagRecord, type OperationalEventRecord, type SloSignalKey, type SloTargetRecord } from "./operations-domain";
export type { ProviderAuthProfileRecord, ProviderAuthSessionRecord } from "./provider-auth-domain";
export { PROVIDER_DATA_POLICY, PROVIDER_EXECUTION_MODE, type ProviderDataPolicy, type ProviderExecutionMode } from "./provider-policy-domain";
export { PROVIDER_REQUEST_STATE, type ProviderRequestRecord, type ProviderRequestState, type ProviderStreamRendererEvent } from "./provider-request-domain";
export type { ProviderRateLimitObservationRecord, ProviderRateLimitStateRecord } from "./provider-runtime-domain";
export type { MigrationCutoverEventRecord, MigrationReconciliationItemRecord, RollbackSnapshotRecord } from "./rollback-domain";
export { EVAL_SUITE_KEY, PR_BOT_GATE_KEY, SDLC_REVIEW_AGENT_KEY, SDLC_REVIEW_TARGET_TYPE, SDLC_RUN_STATE, type EvalCaseRecord, type EvalRunRecord, type EvalSuiteKey, type EvalSuiteRecord, type PrBotGateKey, type PrBotGateRecord, type SdlcReviewAgentKey, type SdlcReviewAgentRecord, type SdlcReviewRunRecord, type SdlcReviewTargetType, type SdlcRunState } from "./sdlc-domain";
export { SEARCH_ENTITY_TYPES, type SearchEntityType, type SearchResultRecord } from "./search-domain";
export type { BrowserActionPolicyRecord, BrowserActionRecord, BrowserSessionContainerRecord, SocialAccountGrantRecord, SocialAccountRecord, SocialApprovalRouteRecord, SocialAuditRecord } from "./social-domain";
export type { AppSnapshot, UiLanguage, UiPreferences, UiTheme } from "./snapshot-domain";
export const TASK_STATUS = { BACKLOG: "backlog", IN_PROGRESS: "in_progress", REVIEW: "review", DONE: "done" } as const;
export const APPROVAL_STATE = { PENDING: "pending", APPROVED: "approved", DECLINED: "declined" } as const;
export const RISK_LEVEL = { LOW: "low", MEDIUM: "medium", HIGH: "high" } as const;
export const TASK_PRIORITY = { LOW: "low", NORMAL: "normal", HIGH: "high" } as const;
/** How a task's output should read: conversational prose carries house style; technical and structured do not. */
export const WRITING_MODE = { CONVERSATIONAL: "conversational", TECHNICAL: "technical", STRUCTURED: "structured" } as const;
export const PROVIDER_AUTH_TYPE = { API_KEY: "api_key", OAUTH_PKCE: "oauth_pkce", ACCOUNT_SUBSCRIPTION: "account_subscription", CLOUD: "cloud" } as const;
export const SOCIAL_PLATFORM = { X: "x", LINKEDIN: "linkedin", YOUTUBE: "youtube", INSTAGRAM: "instagram" } as const;
export const FILE_SCAN_STATE = { APPROVED: "approved", BLOCKED: "blocked" } as const;

export type ValueOf<T> = T[keyof T];
export type WritingMode = ValueOf<typeof WRITING_MODE>;
export type TaskStatus = ValueOf<typeof TASK_STATUS>;
export type ApprovalState = ValueOf<typeof APPROVAL_STATE>;
export type RiskLevel = ValueOf<typeof RISK_LEVEL>;
export type TaskPriority = ValueOf<typeof TASK_PRIORITY>;
export type ProviderAuthType = ValueOf<typeof PROVIDER_AUTH_TYPE>;
export type SocialPlatform = ValueOf<typeof SOCIAL_PLATFORM>;
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
  avatarEmoji: string | null;
  avatarColor: string | null;
  /** Small data-URL portrait; wins over emoji/initials when set. */
  avatarImage: string | null;
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
  avatarEmoji: string | null;
  avatarColor: string | null;
  /** Small data-URL portrait; wins over emoji/initials when set. */
  avatarImage: string | null;
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
  parentTaskId: string | null;
  requiresFilesystem: boolean;
  writingMode: WritingMode;
  /** Set when the task spent its run budget without reaching done. */
  stalledReason: string | null;
  /** Runs at or below this task_runs rowid no longer count toward the run budget. */
  runBudgetFloor: number;
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
  /** Set when the goal's review loop stopped without a decision. */
  stalledReason: string | null;
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
  providerRequestId: string | null;
  executionContextId: string | null;
  serviceIdentityId: string | null;
  workspaceMountJson: string;
  secretScopeJson: string;
  trigger: string;
  state: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  /** JSON RunContextManifest: which messages the run read. */
  contextJson: string | null;
  /** Capabilities the run could not load, one per line, so the user sees what it worked without. */
  capabilityWarnings: string | null;
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
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  state: ApprovalState;
  decisionNotes: string | null;
  decidedByEmployeeId: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface MeetingRecord {
  id: string;
  orgId: string;
  title: string;
  meetingType: string;
  status: string;
  scheduledAt: string | null;
  durationMinutes: number;
  agenda: string;
  notes: string;
  decisions: string;
  createdAt: string;
  updatedAt: string;
}

export interface SprintRecord {
  id: string;
  orgId: string;
  name: string;
  goal: string;
  status: string;
  startDate: string;
  endDate: string;
  velocityPoints: number;
  completedPoints: number;
  retrospective: string;
  createdAt: string;
  updatedAt: string;
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

export interface FileHandoffRecord {
  id: string;
  orgId: string;
  messageId: string;
  fileId: string;
  sourcePrincipalType: "employee" | "agent" | "board" | "system";
  sourcePrincipalId: string | null;
  targetPrincipalType: "employee" | "agent" | "board" | "org_group";
  targetPrincipalId: string;
  transferType: string;
  checksum: string;
  scanState: FileScanState;
  scanLabelsJson: string;
  policyDecision: "approved_for_handoff" | "blocked_by_scan";
  objectRef: string;
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
  dataPolicy: ProviderDataPolicy;
  backgroundEnabled: boolean;
  monthlyRequestLimit: number;
  workspaceScope: string;
  /** Model context window the run budget is computed against. */
  contextWindowTokens: number;
  /** Prices in cents per million tokens; null until the operator sets them. */
  inputCentsPerMtok: number | null;
  cachedInputCentsPerMtok: number | null;
  outputCentsPerMtok: number | null;
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
  /** True when the provider exposes a real models endpoint we can fetch from.
   * When false (e.g. the Codex subscription, which has no enumerable list), the
   * UI offers a free-text model id instead of a fixed dropdown. */
  supportsLiveModels: boolean;
  /** Set for user-configured OpenAI/Anthropic-compatible endpoints: the UI
   * collects a base URL + API key + model instead of a fixed provider form. */
  customEndpoint?: "openai" | "anthropic";
  /** True when disconnecting also revokes the sign-in at the provider; otherwise it only erases it from this computer. */
  revokesRemotely: boolean;
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

export interface SkillTestRecord {
  id: string;
  revisionId: string;
  testType: string;
  expectedOutputRef: string;
  lastResult: string | null;
  lastRunAt: string | null;
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

export interface DocumentRecord {
  id: string;
  orgId: string;
  title: string;
  docType: string;
  content: string;
  status: string;
  authorAgentId: string | null;
  reviewerAgentId: string | null;
  projectId: string | null;
  goalId: string | null;
  taskId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeEntryRecord {
  id: string;
  orgId: string;
  topic: string;
  category: string;
  content: string;
  importance: string;
  sourceType: string;
  sourceId: string | null;
  scopeType: string;
  scopeId: string | null;
  validUntil: string | null;
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorAccountRecord {
  id: string;
  orgId: string;
  toolkitSlug: string;
  toolkitName: string;
  /** Names the account among the toolkit's company accounts, e.g. "main" or "sales". */
  label: string;
  authConfigId: string;
  status: string;
  /** A reconnect waiting for authorization; the current account keeps working until it is active. */
  pendingAccountId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorGrantRecord {
  id: string;
  orgId: string;
  agentId: string;
  toolkitSlug: string;
  accountLabel: string;
  /** JSON array of the only action names this grant allows; null allows every action. */
  allowedActions: string | null;
  /** JSON object of argument values every action under this grant must take; null fixes none. */
  fixedArguments: string | null;
  grantedByType: string;
  grantedById: string | null;
  createdAt: string;
}

export interface AutomationRuleRecord {
  id: string;
  orgId: string;
  name: string;
  triggerEvent: string;
  conditionJson: string;
  actionType: string;
  actionConfigJson: string;
  priority: number;
  enabled: boolean;
  lastFiredAt: string | null;
  fireCount: number;
  createdAt: string;
  updatedAt: string;
}
