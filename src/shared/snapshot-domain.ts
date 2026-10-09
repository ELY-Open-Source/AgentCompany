import type { OnboardingDraft } from "./commands";
import type { UsageStatsRecord } from "./usage-stats";
import type { IntegrationKeyStatus } from "./commands/integration-keys";
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
  ChatReplyStatus,
  ChatSpaceAnchor,
} from "./chat-domain";
import type { ComplianceExportRecord } from "./compliance-domain";
import type {
  AgentRecord,
  ApprovalRecord,
  AuditEventRecord,
  ConnectorAccountRecord,
  ConnectorGrantRecord,
  DocumentRecord,
  EmployeeRecord,
  FileAccessGrantRecord,
  FileHandoffRecord,
  FileObjectRecord,
  GoalRecord,
  KnowledgeEntryRecord,
  MigrationReportRecord,
  OrganizationRecord,
  PolicyRuleRecord,
  ProjectRecord,
  ProviderCatalogEntry,
  ProviderRecord,
  ScheduledPostRecord,
  SkillDefinitionRecord,
  TaskRecord,
  TaskRunRecord,
  WorkspaceRecord,
} from "./domain";
import type { HiringPolicyRecord } from "./org-governance-domain";
import type { ProviderAuthProfileRecord } from "./provider-auth-domain";
import type { ProviderRequestRecord } from "./provider-request-domain";
import type { ProviderRateLimitStateRecord } from "./provider-runtime-domain";
import type {
  BrowserActionPolicyRecord,
  BrowserActionRecord,
  BrowserSessionContainerRecord,
  SocialAccountGrantRecord,
  SocialAccountRecord,
  SocialApprovalRouteRecord,
  SocialAuditRecord,
} from "./social-domain";

/** "clock" turns dark at night and light by day. */
export type UiTheme = "system" | "light" | "dark" | "clock";
export type UiLanguage = "en" | "zh";

export interface UiPreferences {
  theme: UiTheme;
  language: UiLanguage;
}

export interface AppSnapshot {
  activeOrgId: string | null;
  uiPreferences: UiPreferences;
  /** The setup wizard left unfinished, resumed on the next launch. */
  onboardingDraft: OnboardingDraft | null;
  /** Where the operator was: page, sections, filters and selected records, by key. */
  viewState: Record<string, unknown>;
  /** The data version this snapshot was read at. */
  dataVersion: number;
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
  chatReplyStatuses: ChatReplyStatus[];
  chatSpaceAnchors: ChatSpaceAnchor[];
  chatAttachments: ChatAttachmentRecord[];
  chatMentions: ChatMentionRecord[];
  chatSlashInvocations: ChatSlashInvocationRecord[];
  chatPresence: ChatPresenceRecord[];
  chatReadStates: ChatReadStateRecord[];
  files: FileObjectRecord[];
  fileAccessGrants: FileAccessGrantRecord[];
  fileHandoffRecords: FileHandoffRecord[];
  scheduledPosts: ScheduledPostRecord[];
  providers: ProviderRecord[];
  providerAuthProfiles: ProviderAuthProfileRecord[];
  providerCatalog: ProviderCatalogEntry[];
  providerRequests: ProviderRequestRecord[];
  providerRateLimits: ProviderRateLimitStateRecord[];
  /** Period statistics per org over all records, for charts and billing. */
  usageStats: UsageStatsRecord[];
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
  complianceExports: ComplianceExportRecord[];
  hiringPolicies: HiringPolicyRecord[];
  auditEvents: AuditEventRecord[];
  documents: DocumentRecord[];
  knowledgeEntries: KnowledgeEntryRecord[];
  connectorAccounts: ConnectorAccountRecord[];
  connectorGrants: ConnectorGrantRecord[];
}
