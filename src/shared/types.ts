export type SectionId =
  | "overview"
  | "inbox"
  | "standup"
  | "performance"
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
  | "gemini_local"
  | "opencode_local"
  | "kimi_local";

export type ConnectorStatus =
  | "not_installed"
  | "detected"
  | "auth_required"
  | "ready"
  | "degraded"
  | "error";

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
  | "incident_escalation";
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

// ── Departments ────────────────────────────────────────────────────────
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
  browserActions: BrowserActionRecord[];
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

export type HeartbeatTrigger = "manual" | "timer" | "assignment" | "goal_activated" | "approval_resolved" | "subtask_completed" | "comment" | "report_blocked" | "report_failed" | "recovery" | "message" | "peer_request";

export interface CommentRecord {
  id: string;
  companyId: string;
  taskId: string;
  authorAgentId: string | null;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface OrgChartNode {
  agent: AgentRecord;
  children: OrgChartNode[];
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

export type DesktopEvent =
  | LogChunkEvent
  | DomainChangedEvent
  | ShortcutEvent
  | RunStatusEvent
  | HeartbeatStatusEvent
  | AgentMessageEvent
  | AutomationFiredEvent
  | NewMessageEvent;

// ── Inbox ──────────────────────────────────────────────────────────────
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
  dismissed: boolean;
}

// ── Performance Metrics ────────────────────────────────────────────────
export interface AgentMetrics {
  agentId: string;
  agentName: string;
  tasksCompleted: number;
  tasksAssigned: number;
  tasksFailed: number;
  successRate: number; // 0-100
  avgRunDurationSec: number;
  totalCostUsd: number;
  runsTotal: number;
  runsSucceeded: number;
  runsFailed: number;
  reviewCycles: number; // how many times work was sent back for revision
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

// ── Company Template ───────────────────────────────────────────────────
export interface CompanyTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  agents: Array<{
    name: string;
    role: string;
    title: string;
    department: DepartmentId;
    capabilities: string;
    reportsToIndex: number | null; // index in this array, null = CEO
    connectorPreference: ConnectorId;
    budgetMonthlyUsd: number;
  }>;
  goals: Array<{
    title: string;
    description: string;
  }>;
  departments?: Array<{
    id: DepartmentId;
    name: string;
    description: string;
  }>;
}

// ── Social Media / Browser Automation ──────────────────────────────
export type SocialPlatform = "twitter" | "linkedin" | "instagram" | "facebook" | "reddit" | "youtube" | "tiktok" | "bluesky" | "other";
export type SocialAccountStatus = "active" | "logged_in" | "login_required" | "suspended" | "paused";
export type BrowserActionType = "post" | "reply" | "like" | "follow" | "browse_feed" | "screenshot" | "navigate" | "search" | "dm" | "custom_script";
export type BrowserActionStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "approval_required";

export interface SocialAccountRecord {
  id: string;
  companyId: string;
  platform: SocialPlatform;
  accountName: string;
  displayName: string;
  profileUrl: string;
  /** Secret ID for stored credentials (username/password/cookies) */
  credentialSecretId: string | null;
  status: SocialAccountStatus;
  /** Whether posts require Board approval before publishing */
  requireApproval: boolean;
  /** JSON metadata: bio, follower count, etc. */
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
  /** JSON payload: content, targetUrl, selector, script, etc. */
  payloadJson: string;
  status: BrowserActionStatus;
  /** Result summary after execution */
  resultSummary: string;
  /** Screenshot path after execution */
  screenshotPath: string | null;
  /** Approval ID if approval was required */
  approvalId: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Meetings ──────────────────────────────────────────────────────────
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

// ── Documents ─────────────────────────────────────────────────────────
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

// ── Knowledge Base ────────────────────────────────────────────────────
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
  referencedEntityType: string | null;
  referencedEntityId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Sprints ───────────────────────────────────────────────────────────
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

// ── Performance Reviews ───────────────────────────────────────────────
export type ReviewStatus = "draft" | "submitted" | "acknowledged";

export interface PerformanceReviewRecord {
  id: string;
  companyId: string;
  agentId: string;
  reviewerAgentId: string;
  period: string; // e.g., "2026-Q1"
  rating: number; // 1-5
  strengths: string;
  areasForImprovement: string;
  goals: string;
  status: ReviewStatus;
  createdAt: string;
  updatedAt: string;
}

// ── Standup Report ─────────────────────────────────────────────────────
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
  budgetUtilization: number; // 0-100
}

// ── Automation Engine ─────────────────────────────────────────────────
export type AutomationTrigger =
  | "task_status_changed"
  | "task_created"
  | "task_blocked"
  | "run_completed"
  | "run_failed"
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
  /** JSON conditions: e.g., {"status": "blocked", "department": "engineering"} */
  conditionsJson: string;
  action: AutomationAction;
  /** JSON action config: e.g., {"targetAgentId": "...", "message": "..."} */
  actionConfigJson: string;
  /** Source department that triggers (null = any) */
  sourceDepartment: DepartmentId | null;
  /** Target department for cross-department rules (null = same) */
  targetDepartment: DepartmentId | null;
  priority: number;
  status: AutomationStatus;
  /** How many times this rule has fired */
  executionCount: number;
  lastExecutedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Agent Messages (Direct Communication) ─────────────────────────────
export type MessageChannel = "direct" | "department" | "company" | "project" | "incident";
export type MessagePriority = "urgent" | "normal" | "low";

export interface AgentMessageRecord {
  id: string;
  companyId: string;
  fromAgentId: string;
  /** null = broadcast to channel */
  toAgentId: string | null;
  channel: MessageChannel;
  /** Department/project/incident ID for channel messages */
  channelTargetId: string | null;
  subject: string;
  body: string;
  priority: MessagePriority;
  /** Whether the recipient has read this message */
  readAt: string | null;
  /** Parent message ID for threads */
  parentMessageId: string | null;
  /** JSON: attached entity references [{type, id, title}] */
  attachmentsJson: string;
  createdAt: string;
}

// ── Workflow Pipeline ──────────────────────────────────────────────────
export type WorkflowStatus = "draft" | "active" | "paused" | "completed" | "failed";

export interface WorkflowPipelineRecord {
  id: string;
  companyId: string;
  name: string;
  description: string;
  /** JSON array of pipeline steps */
  stepsJson: string;
  triggerType: AutomationTrigger;
  triggerConfigJson: string;
  status: WorkflowStatus;
  currentStepIndex: number;
  /** How many times this pipeline has run */
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
  /** Wait for approval before proceeding */
  requiresApproval: boolean;
  /** Timeout in seconds (0 = no timeout) */
  timeoutSec: number;
  /** Status of this step */
  status: "pending" | "running" | "completed" | "failed" | "skipped";
}

// ── Cross-Department Trigger Table ────────────────────────────────────
export interface CrossDeptTrigger {
  sourceEvent: string;
  sourceDepartment: DepartmentId;
  targetDepartment: DepartmentId;
  targetAction: string;
  description: string;
}
