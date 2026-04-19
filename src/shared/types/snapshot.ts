import type {
  CompanyRecord,
  ConnectorRecord,
  WorkspaceRecord,
  AgentRecord,
  GoalRecord,
  ProjectRecord,
  TaskRecord,
  ApprovalRecord,
  RunRecord,
  CostRecord,
  ActivityRecord,
  SecretRecord,
  CommentRecord,
} from "./records-core";
import type {
  SocialAccountRecord,
  MeetingRecord,
  DocumentRecord,
  KnowledgeEntryRecord,
  SprintRecord,
  AutomationRuleRecord,
  AgentMessageRecord,
  WorkflowPipelineRecord,
  WorkProductRecord,
} from "./records-extended";

export interface ProfileSnapshot {
  // ─── Profile-level (shared across all companies) ─────────────────────────
  currentCompanyId: string | null;
  profilePath: string;
  updatesEnabled: boolean;
  theme: "system" | "light" | "dark";
  locale: "en" | "zh";
  backend: {
    secretBackend: string;
  };
  companies: CompanyRecord[];
  connectors: ConnectorRecord[];
  // ─── Company-scoped collections (current company only) ───────────────────
  workspaces: WorkspaceRecord[];
  agents: AgentRecord[];
  goals: GoalRecord[];
  projects: ProjectRecord[];
  tasks: TaskRecord[];
  approvals: ApprovalRecord[];
  runs: RunRecord[];
  costs: CostRecord[];
  activity: ActivityRecord[];
  secrets: SecretRecord[];
  comments: CommentRecord[];
  socialAccounts: SocialAccountRecord[];
  meetings: MeetingRecord[];
  documents: DocumentRecord[];
  workProducts: WorkProductRecord[];
  knowledgeBase: KnowledgeEntryRecord[];
  sprints: SprintRecord[];
  automationRules: AutomationRuleRecord[];
  agentMessages: AgentMessageRecord[];
  workflows: WorkflowPipelineRecord[];
}

/** Fields that are shared across companies and loaded regardless of currentCompanyId. */
export const PROFILE_LEVEL_KEYS = [
  "currentCompanyId",
  "profilePath",
  "updatesEnabled",
  "theme",
  "locale",
  "backend",
  "companies",
  "connectors",
] as const satisfies ReadonlyArray<keyof ProfileSnapshot>;

/** Fields that are filtered to the current company; switching companies reloads these. */
export const COMPANY_SCOPED_KEYS = [
  "workspaces",
  "agents",
  "goals",
  "projects",
  "tasks",
  "approvals",
  "runs",
  "costs",
  "activity",
  "secrets",
  "comments",
  "socialAccounts",
  "meetings",
  "documents",
  "workProducts",
  "knowledgeBase",
  "sprints",
  "automationRules",
  "agentMessages",
  "workflows",
] as const satisfies ReadonlyArray<keyof ProfileSnapshot>;

export type ProfileLevelKey = typeof PROFILE_LEVEL_KEYS[number];
export type CompanyScopedKey = typeof COMPANY_SCOPED_KEYS[number];

