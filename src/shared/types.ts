export type SectionId =
  | "overview"
  | "connectors"
  | "agents"
  | "orgchart"
  | "goals"
  | "projects"
  | "tasks"
  | "approvals"
  | "costs"
  | "activity"
  | "workspaces"
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

export interface AgentRecord {
  id: string;
  companyId: string;
  name: string;
  role: string;
  title: string;
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
  type: "hire_agent" | "approve_ceo_strategy" | "dangerous_command" | "secret_access";
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

export type HeartbeatTrigger = "manual" | "timer" | "assignment" | "goal_activated" | "approval_resolved" | "subtask_completed" | "comment" | "report_blocked" | "report_failed" | "recovery";

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

export type DesktopEvent =
  | LogChunkEvent
  | DomainChangedEvent
  | ShortcutEvent
  | RunStatusEvent
  | HeartbeatStatusEvent
  | AgentMessageEvent;
