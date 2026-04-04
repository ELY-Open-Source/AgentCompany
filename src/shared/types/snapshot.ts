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
} from "./records-extended";

export interface ProfileSnapshot {
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
  knowledgeBase: KnowledgeEntryRecord[];
  sprints: SprintRecord[];
  automationRules: AutomationRuleRecord[];
  agentMessages: AgentMessageRecord[];
  workflows: WorkflowPipelineRecord[];
}

