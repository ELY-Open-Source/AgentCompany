export type SectionId =
  | "overview"
  | "inbox"
  | "standup"
  | "performance"
  | "runs"
  | "connectors"
  | "agents"
  | "orgchart"
  | "hiring"
  | "goals"
  | "projects"
  | "tasks"
  | "approvals"
  | "costs"
  | "activity"
  | "workspaces"
  | "social"
  | "automation"
  | "communication"
  | "documents"
  | "knowledge"
  | "meetings"
  | "sprints"
  | "settings";

export type ConnectorId =
  | "codex_local"
  | "claude_local"
  | "gemini_local";

export type ConnectorStatus =
  | "not_installed"
  | "detected"
  | "auth_required"
  | "ready"
  | "degraded"
  | "error";

export type TaskType = "code" | "research" | "content" | "management" | "general";

export type WorkspaceState = "ready" | "busy" | "blocked" | "missing" | "error";
export type CompanyStatus = "active" | "paused" | "archived";
export type AgentStatus =
  | "idle"
  | "active"
  | "running"
  | "paused"
  | "error"
  | "pending_approval"
  | "terminated";
export type GoalStatus = "planned" | "active" | "achieved" | "cancelled";
export type ProjectStatus = "backlog" | "planned" | "in_progress" | "completed" | "cancelled";
export type TaskStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "blocked" | "cancelled";
export type ApprovalState = "pending" | "approved" | "rejected" | "revision_requested";
export type ApprovalType =
  | "hire_agent"
  | "approve_ceo_strategy"
  | "dangerous_command"
  | "secret_access"
  | "budget_request"
  | "promotion"
  | "termination"
  | "vendor_approval"
  | "document_review"
  | "production_deploy"
  | "incident_escalation"
  | "social_post"
  | "deliverable_review";
export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "interrupted";

export interface CapabilityMatrix {
  sessionResume: boolean;
  gracefulCancel: boolean;
  modelDiscovery: boolean;
  structuredTranscript: boolean;
  costAttribution: boolean;
}

export interface CompanyRecord {
  id: string;
  name: string;
  description: string;
  status: CompanyStatus;
  autoApproveHires: boolean;
  reviewDeliverables: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorRecord {
  id: ConnectorId;
  label: string;
  description: string;
  status: ConnectorStatus;
  command: string;
  version: string | null;
  authState: "unknown" | "ok" | "required" | "error";
  lastCheckedAt: string | null;
  lastError: string | null;
  model: string | null;
  envBindingText: string;
  notes: string;
  configurationDoc: string;
  capabilityMatrix: CapabilityMatrix;
}

export interface WorkspaceRecord {
  id: string;
  companyId: string;
  name: string;
  localPath: string;
  repoUrl: string;
  repoRef: string;
  projectId: string | null;
  state: WorkspaceState;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
}

export type DepartmentId =
  | "executive"
  | "engineering"
  | "product"
  | "marketing"
  | "sales"
  | "hr"
  | "finance"
  | "legal"
  | "operations"
  | "customer_support"
  | "research"
  | "design";

export interface AgentRecord {
  id: string;
  companyId: string;
  name: string;
  role: string;
  title: string;
  department: DepartmentId | null;
  status: AgentStatus;
  reportsTo: string | null;
  connectorId: ConnectorId;
  workspaceId: string | null;
  model: string | null;
  capabilities: string;
  budgetMonthlyUsd: number;
  spentMonthlyUsd: number;
  metadataJson: string;
  heartbeatEnabled: boolean;
  heartbeatIntervalSec: number;
  lastHeartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GoalRecord {
  id: string;
  companyId: string;
  title: string;
  description: string;
  parentId: string | null;
  ownerAgentId: string | null;
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRecord {
  id: string;
  companyId: string;
  goalId: string | null;
  name: string;
  description: string;
  leadAgentId: string | null;
  status: ProjectStatus;
  targetDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRecord {
  id: string;
  companyId: string;
  projectId: string | null;
  goalId: string | null;
  parentId: string | null;
  title: string;
  description: string;
  assigneeAgentId: string | null;
  workspaceId: string | null;
  status: TaskStatus;
  priority: "critical" | "high" | "medium" | "low";
  activeRunId: string | null;
  sessionJson: string | null;
  sessionDisplayId: string | null;
  costUsd: number;
  requiresUserReview: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRecord {
  id: string;
  companyId: string;
  relatedTaskId: string | null;
  relatedAgentId: string | null;
  requestedByAgentId: string | null;
  type: ApprovalType;
  payloadSummary: string;
  impactSummary: string;
  payloadJson: string | null;
  decisionNote: string;
  state: ApprovalState;
  createdAt: string;
  updatedAt: string;
}

export interface RunRecord {
  id: string;
  companyId: string;
  taskId: string;
  agentId: string;
  workspaceId: string | null;
  connectorId: ConnectorId;
  status: RunStatus;
  summary: string;
  errorMessage: string | null;
  exitCode: number | null;
  signal: string | null;
  model: string | null;
  sessionDisplayId: string | null;
  costUsd: number | null;
  unattributedCost: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  logPath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunLogChunk {
  content: string;
  offset: number;
  nextOffset: number;
  totalBytes: number;
  eof: boolean;
}

export interface CostRecord {
  id: string;
  companyId: string;
  runId: string;
  taskId: string | null;
  agentId: string | null;
  connectorId: ConnectorId;
  amountUsd: number | null;
  unattributed: boolean;
  createdAt: string;
}

export interface ActivityRecord {
  id: string;
  companyId: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  detail: string;
  createdAt: string;
}

export interface SecretRecord {
  id: string;
  companyId: string;
  name: string;
  description: string;
  backend: "safe_storage" | "vault";
  updatedAt: string;
}

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

export interface LogChunkEvent {
  type: "run-log";
  runId: string;
  stream: "stdout" | "stderr";
  chunk: string;
}

export interface DomainChangedEvent {
  type: "domain-changed";
}

export interface ShortcutEvent {
  type: "shortcut";
  action: "toggle-command-palette" | "toggle-console" | "refresh";
}

export interface RunStatusEvent {
  type: "run-status";
  runId: string;
  status: RunStatus;
  message: string;
}

export interface CommentRecord {
  id: string;
  companyId: string;
  taskId: string;
  authorAgentId: string | null;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface HeartbeatStatusEvent {
  type: "heartbeat-status";
  agentId: string;
  enabled: boolean;
  nextWakeAt: string | null;
}

export interface AgentMessageEvent {
  type: "agent-message";
  taskId: string;
  comment: CommentRecord;
}

export interface AutomationFiredEvent {
  type: "automation-fired";
  ruleId: string;
  ruleName: string;
  trigger: AutomationTrigger;
  action: AutomationAction;
}

export interface NewMessageEvent {
  type: "new-message";
  message: AgentMessageRecord;
}

export interface NotificationClickEvent {
  type: "notification-click";
  section: SectionId;
  entityId?: string;
}

export type DesktopEvent =
  | LogChunkEvent
  | DomainChangedEvent
  | ShortcutEvent
  | RunStatusEvent
  | HeartbeatStatusEvent
  | AgentMessageEvent
  | AutomationFiredEvent
  | NewMessageEvent
  | NotificationClickEvent;

export type InboxItemType = "pending_approval" | "failed_run" | "budget_warning" | "blocked_task" | "review_needed" | "agent_message";

export interface InboxItem {
  id: string;
  type: InboxItemType;
  title: string;
  subtitle: string;
  severity: "critical" | "high" | "medium" | "low";
  entityType: string;
  entityId: string;
  agentId: string | null;
  agentName: string | null;
  createdAt: string;
}

export interface AgentMetrics {
  agentId: string;
  agentName: string;
  tasksCompleted: number;
  tasksAssigned: number;
  tasksFailed: number;
  successRate: number;
  avgRunDurationSec: number;
  totalCostUsd: number;
  runsTotal: number;
  runsSucceeded: number;
  runsFailed: number;
  reviewCycles: number;
  lastActiveAt: string | null;
}

export interface CompanyMetrics {
  totalAgents: number;
  activeAgents: number;
  totalTasks: number;
  completedTasks: number;
  blockedTasks: number;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  overallSuccessRate: number;
  totalCostUsd: number;
  avgCostPerTask: number;
  throughputTasksPerDay: number;
  agentMetrics: AgentMetrics[];
}

export interface OnboardingBootstrapResult {
  companyId: string;
  companyName: string;
  workspaceId: string | null;
  leadAgentId: string | null;
  projectId: string | null;
  taskId: string | null;
  runId: string | null;
}

export type SocialPlatform = "twitter" | "linkedin" | "instagram" | "facebook" | "reddit" | "youtube" | "tiktok" | "bluesky" | "other";
export type SocialAccountStatus = "active" | "logged_in" | "login_required" | "suspended" | "paused";
export type BrowserActionType = "post" | "reply" | "like" | "follow" | "browse_feed" | "screenshot" | "navigate" | "search";
export type BrowserActionStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "approval_required";

export interface SocialAccountRecord {
  id: string;
  companyId: string;
  platform: SocialPlatform;
  accountName: string;
  displayName: string;
  profileUrl: string;
  credentialSecretId: string | null;
  status: SocialAccountStatus;
  requireApproval: boolean;
  metadataJson: string;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BrowserActionRecord {
  id: string;
  companyId: string;
  socialAccountId: string;
  agentId: string;
  taskId: string | null;
  actionType: BrowserActionType;
  payloadJson: string;
  status: BrowserActionStatus;
  resultSummary: string;
  screenshotPath: string | null;
  approvalId: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MeetingType =
  | "standup"
  | "sprint_planning"
  | "sprint_review"
  | "retrospective"
  | "one_on_one"
  | "all_hands"
  | "department_sync"
  | "incident_review"
  | "hiring_committee"
  | "budget_review"
  | "design_review"
  | "architecture_review";

export type MeetingStatus = "scheduled" | "in_progress" | "completed" | "cancelled";

export interface MeetingRecord {
  id: string;
  companyId: string;
  type: MeetingType;
  title: string;
  organizerAgentId: string | null;
  participantAgentIds: string; // JSON array of agent IDs
  scheduledAt: string;
  durationMinutes: number;
  agendaJson: string;
  notesJson: string;
  decisionsJson: string;
  actionItemsJson: string;
  status: MeetingStatus;
  createdAt: string;
  updatedAt: string;
}

export type DocumentType =
  | "prd"
  | "technical_spec"
  | "design_doc"
  | "test_plan"
  | "post_mortem"
  | "meeting_notes"
  | "budget_proposal"
  | "hiring_requisition"
  | "performance_review_doc"
  | "sop"
  | "knowledge_article"
  | "project_brief"
  | "sprint_report"
  | "incident_report"
  | "onboarding_guide"
  | "architecture_decision"
  | "status_report"
  | "contract"
  | "proposal";

export type DocumentStatus = "draft" | "in_review" | "approved" | "archived" | "superseded";

export interface DocumentRecord {
  id: string;
  companyId: string;
  type: DocumentType;
  title: string;
  content: string;
  authorAgentId: string | null;
  reviewerAgentId: string | null;
  projectId: string | null;
  goalId: string | null;
  parentDocId: string | null;
  version: number;
  status: DocumentStatus;
  tagsJson: string;
  createdAt: string;
  updatedAt: string;
}

export type KnowledgeCategory =
  | "lesson_learned"
  | "best_practice"
  | "decision"
  | "process"
  | "technical"
  | "business"
  | "onboarding"
  | "incident";

export interface KnowledgeEntryRecord {
  id: string;
  companyId: string;
  category: KnowledgeCategory;
  topic: string;
  content: string;
  authorAgentId: string | null;
  importance: "critical" | "high" | "medium" | "low";
  tagsJson: string;
  referencedEntityType:
    | "agents"
    | "goals"
    | "projects"
    | "tasks"
    | "approvals"
    | "runs"
    | "secrets"
    | "meetings"
    | "documents"
    | "knowledge_base"
    | "sprints"
    | "automation_rules"
    | "workflow_pipelines"
    | null;
  referencedEntityId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SprintStatus = "planning" | "active" | "review" | "completed" | "cancelled";

export interface SprintRecord {
  id: string;
  companyId: string;
  name: string;
  goal: string;
  startDate: string;
  endDate: string;
  status: SprintStatus;
  retrospectiveNotes: string;
  velocityPoints: number;
  completedPoints: number;
  createdAt: string;
  updatedAt: string;
}

export interface StandupReport {
  companyId: string;
  generatedAt: string;
  summary: string;
  agentReports: Array<{
    agentId: string;
    agentName: string;
    role: string;
    status: AgentStatus;
    tasksInProgress: number;
    tasksCompleted24h: number;
    tasksBlocked: number;
    lastRunStatus: RunStatus | null;
    lastRunAt: string | null;
    costLast24h: number;
    highlights: string[];
  }>;
  companyHighlights: string[];
  blockers: string[];
  pendingApprovals: number;
  budgetUtilization: number;
}

export type AutomationTrigger =
  | "task_status_changed"
  | "task_created"
  | "task_blocked"
  | "task_reassigned"
  | "run_completed"
  | "run_failed"
  | "approval_created"
  | "approval_resolved"
  | "budget_threshold"
  | "agent_idle"
  | "comment_posted"
  | "document_created"
  | "schedule"
  | "hire_approved"
  | "sprint_started"
  | "sprint_ended";

export type AutomationAction =
  | "assign_task"
  | "create_task"
  | "notify_agent"
  | "send_message"
  | "trigger_heartbeat"
  | "create_approval"
  | "update_task_status"
  | "escalate_to_manager"
  | "cross_department_notify"
  | "schedule_meeting"
  | "create_document"
  | "auto_approve"
  | "reassign_task"
  | "run_task";

export type AutomationStatus = "active" | "paused" | "disabled" | "error";

export interface AutomationRuleRecord {
  id: string;
  companyId: string;
  name: string;
  description: string;
  trigger: AutomationTrigger;
  conditionsJson: string;
  action: AutomationAction;
  actionConfigJson: string;
  sourceDepartment: DepartmentId | null;
  targetDepartment: DepartmentId | null;
  priority: number;
  status: AutomationStatus;
  executionCount: number;
  lastExecutedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MessageChannel = "direct" | "department" | "company" | "project" | "incident";
export type MessagePriority = "urgent" | "normal" | "low";

export interface AgentMessageRecord {
  id: string;
  companyId: string;
  fromAgentId: string;
  toAgentId: string | null;
  channel: MessageChannel;
  channelTargetId: string | null;
  subject: string;
  body: string;
  priority: MessagePriority;
  readAt: string | null;
  parentMessageId: string | null;
  attachmentsJson: string;
  createdAt: string;
}

export type WorkflowStatus = "draft" | "active" | "paused" | "completed" | "failed";

export interface WorkflowPipelineRecord {
  id: string;
  companyId: string;
  name: string;
  description: string;
  stepsJson: string;
  triggerType: AutomationTrigger;
  triggerConfigJson: string;
  status: WorkflowStatus;
  currentStepIndex: number;
  runCount: number;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStep {
  id: string;
  name: string;
  action: AutomationAction;
  configJson: string;
  assigneeDepartment: DepartmentId | null;
  assigneeAgentId: string | null;
  requiresApproval: boolean;
  timeoutSec: number;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
}
