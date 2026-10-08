import type { UsageStatsRecord } from "./usage-stats";
import type { AuditReplayRunRecord } from "./audit-domain";
import type { IntegrationKeyStatus } from "./commands/integration-keys";
import type { BoardInterventionRecord as BoardInterventionRecordModel } from "./board-domain";
import type {
  ChatAttachmentRecord,
  ChatMembershipRecord,
  ChatMentionRecord,
  ChatMessageRecord,
  ChatPresenceRecord,
  ChatReadStateRecord,
  ChatSlashInvocationRecord,
  ChatSpaceRecord,
  ChatThreadRecord,
} from "./chat-domain";
import type { ComplianceExportRecord, LegalHoldRecord, RetentionFreezeRecord } from "./compliance-domain";
import type {
  AgentRecord,
  ApprovalRecord,
  AuditEventRecord,
  AutomationRuleRecord,
  ConnectorAccountRecord,
  ConnectorGrantRecord,
  DocumentRecord,
  EmployeeRecord,
  FileAccessGrantRecord,
  FileHandoffRecord,
  FileObjectRecord,
  GoalRecord,
  KnowledgeEntryRecord,
  MeetingRecord,
  MigrationReportRecord,
  OrganizationRecord,
  PolicyRuleRecord,
  ProjectRecord,
  ProviderCatalogEntry,
  ProviderRecord,
  ScheduledPostRecord,
  SkillDefinitionRecord,
  SprintRecord,
  TaskRecord,
  TaskRunRecord,
  WorkspaceRecord,
} from "./domain";
import type { AccessDecisionRecord, EmployeeIdentityRecord, RoleGrantRecord, ServiceIdentityRecord } from "./identity-domain";
import type { ApprovalAssignmentRecord, ApprovalRoutingRuleRecord, HiringPolicyRecord, OrgDepartmentRecord } from "./org-governance-domain";
import type { ChaosDrillRecord, ChaosDrillRunRecord, FeatureFlagRecord, OperationalEventRecord, SloTargetRecord } from "./operations-domain";
import type { ProviderAuthProfileRecord, ProviderAuthSessionRecord } from "./provider-auth-domain";
import type { ProviderRequestRecord } from "./provider-request-domain";
import type { ProviderRateLimitObservationRecord, ProviderRateLimitStateRecord } from "./provider-runtime-domain";
import type { MigrationCutoverEventRecord, MigrationReconciliationItemRecord, RollbackSnapshotRecord } from "./rollback-domain";
import type { EvalCaseRecord, EvalRunRecord, EvalSuiteRecord, PrBotGateRecord, SdlcReviewAgentRecord, SdlcReviewRunRecord } from "./sdlc-domain";
import type {
  BrowserActionPolicyRecord,
  BrowserActionRecord,
  BrowserSessionContainerRecord,
  SocialAccountGrantRecord,
  SocialAccountRecord,
  SocialApprovalRouteRecord,
  SocialAuditRecord,
} from "./social-domain";

export type UiTheme = "system" | "light" | "dark";
export type UiLanguage = "en" | "zh";

export interface UiPreferences {
  theme: UiTheme;
  language: UiLanguage;
}

export interface AppSnapshot {
  activeOrgId: string | null;
  uiPreferences: UiPreferences;
  /** True while the operator has paused the autonomous run engine. */
  autonomousPaused: boolean;
  integrationKeys: IntegrationKeyStatus[];
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
  chatMemberships: ChatMembershipRecord[];
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
  fileHandoffRecords: FileHandoffRecord[];
  scheduledPosts: ScheduledPostRecord[];
  providers: ProviderRecord[];
  providerAuthProfiles: ProviderAuthProfileRecord[];
  providerAuthSessions: ProviderAuthSessionRecord[];
  providerCatalog: ProviderCatalogEntry[];
  providerRequests: ProviderRequestRecord[];
  providerRateLimits: ProviderRateLimitStateRecord[];
  /** Period statistics per org over all records, for charts and billing. */
  usageStats: UsageStatsRecord[];
  providerRateLimitObservations: ProviderRateLimitObservationRecord[];
  // The snapshot is the renderer's working set and rides IPC on every
  // refresh. Skill internals (revisions, bindings, per-run runtime
  // snapshots with compiled prompts) are main-process concerns and stay out
  // of it; only the lightweight catalogue listing ships.
  skillDefinitions: SkillDefinitionRecord[];
  socialAccounts: SocialAccountRecord[];
  socialAccountGrants: SocialAccountGrantRecord[];
  browserSessionContainers: BrowserSessionContainerRecord[];
  browserActionPolicies: BrowserActionPolicyRecord[];
  socialApprovalRoutes: SocialApprovalRouteRecord[];
  browserActions: BrowserActionRecord[];
  socialAuditRecords: SocialAuditRecord[];
  policyRules: PolicyRuleRecord[];
  migrationReports: MigrationReportRecord[];
  rollbackSnapshots: RollbackSnapshotRecord[];
  migrationCutoverEvents: MigrationCutoverEventRecord[];
  migrationReconciliationItems: MigrationReconciliationItemRecord[];
  complianceExports: ComplianceExportRecord[];
  legalHolds: LegalHoldRecord[];
  retentionFreezes: RetentionFreezeRecord[];
  employeeIdentities: EmployeeIdentityRecord[];
  serviceIdentities: ServiceIdentityRecord[];
  roleGrants: RoleGrantRecord[];
  accessDecisions: AccessDecisionRecord[];
  orgDepartments: OrgDepartmentRecord[];
  hiringPolicies: HiringPolicyRecord[];
  approvalRoutingRules: ApprovalRoutingRuleRecord[];
  approvalAssignments: ApprovalAssignmentRecord[];
  featureFlags: FeatureFlagRecord[];
  sloTargets: SloTargetRecord[];
  operationalEvents: OperationalEventRecord[];
  chaosDrills: ChaosDrillRecord[];
  chaosDrillRuns: ChaosDrillRunRecord[];
  sdlcReviewAgents: SdlcReviewAgentRecord[];
  sdlcReviewRuns: SdlcReviewRunRecord[];
  evalSuites: EvalSuiteRecord[];
  evalCases: EvalCaseRecord[];
  evalRuns: EvalRunRecord[];
  prBotGates: PrBotGateRecord[];
  auditReplayRuns: AuditReplayRunRecord[];
  auditEvents: AuditEventRecord[];
  documents: DocumentRecord[];
  knowledgeEntries: KnowledgeEntryRecord[];
  automationRules: AutomationRuleRecord[];
  meetings: MeetingRecord[];
  sprints: SprintRecord[];
  connectorAccounts: ConnectorAccountRecord[];
  connectorGrants: ConnectorGrantRecord[];
}
