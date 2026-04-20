import type {
  ConnectorId,
  ConnectorStatus,
  CompanyStatus,
  ExecutionMode,
  WorkspaceState,
  DepartmentId,
  AgentStatus,
  AgentRoleLevel,
  AgentModelStrategy,
  GoalStatus,
  ProjectStatus,
  TaskStatus,
  ApprovalState,
  ApprovalType,
  RunStatus,
  SkillSourceType,
  TrustLevel,
} from "./enums";

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
  executionMode: ExecutionMode;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorRecord {
  id: ConnectorId;
  label: string;
  description: string;
  status: ConnectorStatus;
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
  /**
   * Seniority enum used for leadership detection; free-text `role` remains
   * UI-editable. Optional on the read model because the DB column has a
   * `DEFAULT 'ic'` and no write path (agent-form / saveAgent / hireRequest)
   * currently accepts it. Consumers use `agentIsLeader()` which handles the
   * null/undefined case via keyword fallback.
   */
  roleLevel?: AgentRoleLevel | null;
  department: DepartmentId | null;
  status: AgentStatus;
  reportsTo: string | null;
  connectorId: ConnectorId;
  workspaceId: string | null;
  model: string | null;
  /**
   * Model routing strategy (v39+). See AgentModelStrategy in enums.ts.
   * Optional on the read model because the DB column has a schema-level
   * default of 'explicit' for existing rows and legacy AgentRecord literals
   * in tests predate this field.
   */
  modelStrategy?: AgentModelStrategy | null;
  capabilities: string;
  budgetMonthlyUsd: number;
  spentMonthlyUsd: number;
  metadataJson: string;
  heartbeatEnabled: boolean;
  heartbeatIntervalSec: number;
  lastHeartbeatAt: string | null;
  /**
   * Agent-scoped active session id. One active session per agent (per
   * company) — switching tasks appends a "now work on X" user turn to the
   * agent's ongoing transcript rather than starting a fresh session.
   * Optional on the read model for the same reason `roleLevel` is: existing
   * callers constructing an AgentRecord literally (tests, fixtures) do not
   * need to set it, and pre-migration rows legitimately have NULL.
   */
  sessionId?: string | null;
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
  costUsd: number;
  taskType: string | null;
  requiresUserReview: boolean;
  /**
   * Per-task filesystem lock policy (v52+). When `true` the
   * orchestrator resolves a workspace and holds it exclusively for
   * the duration of the run; when `false` the run executes with
   * `lockMode='none'` and agents run in parallel on shared read-only
   * context. Inferred from agent role at task creation and toggled
   * explicitly by callers that know their task mutates the tree.
   */
  requiresFilesystem: boolean;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
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
  taskId: string | null;
  agentId: string;
  workspaceId: string | null;
  connectorId: ConnectorId;
  status: RunStatus;
  summary: string;
  errorMessage: string | null;
  exitCode: number | null;
  signal: string | null;
  model: string | null;
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

export interface BudgetPolicyRecord {
  id: string;
  companyId: string;
  scopeType: "company" | "agent" | "project";
  scopeId: string;
  metric: string;
  windowKind: string;
  amount: number; // INTEGER cents
  warnPercent: number;
  hardStopEnabled: boolean;
  notifyEnabled: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetIncidentRecord {
  id: string;
  companyId: string;
  policyId: string;
  scopeType: string;
  scopeId: string;
  metric: string;
  windowKind: string;
  windowStart: string;
  windowEnd: string;
  thresholdType: "warn_threshold" | "hard_stop";
  amountLimit: number;
  amountObserved: number;
  status: "open" | "resolved" | "auto_resolved_limit_increase" | "auto_closed";
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetStatusSummary {
  policies: Array<{
    policyId: string;
    scopeType: string;
    scopeId: string;
    amount: number;
    spent: number;
    warnPercent: number;
    hardStopEnabled: boolean;
    hasOpenIncident: boolean;
  }>;
}

export interface TaskSessionRecord {
  id: string;
  companyId: string;
  agentId: string;
  adapterType: string;
  lastRunId: string | null;
  lastError: string | null;
  runCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  rotatedAt: string | null;
  rotationReason: string | null;
  handoffMarkdown: string | null;
  createdAt: string;
  updatedAt: string;
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

export interface CommentRecord {
  id: string;
  companyId: string;
  taskId: string;
  authorAgentId: string | null;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface FileInventoryEntry {
  path: string;
  kind: "skill" | "reference" | "script" | "asset" | "markdown" | "other";
}

export interface SkillRecord {
  id: string;
  companyId: string;
  key: string;
  slug: string;
  name: string;
  description: string | null;
  sourceType: SkillSourceType;
  sourceLocator: string | null;
  sourceRef: string | null;
  trustLevel: TrustLevel;
  compatibility: string;
  fileInventory: FileInventoryEntry[];
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface SkillImportResult {
  skillId: string;
  key: string;
  name: string;
  isUpdate: boolean;
}

export interface SkillUpdateStatus {
  skillId: string;
  key: string;
  currentRef: string | null;
  latestRef: string | null;
  hasUpdate: boolean;
}

export type MentionOutcome = "woken" | "queued" | "busy" | "not_found";

export interface MentionResult {
  agentId: string;
  agentName: string;
  outcome: MentionOutcome;
}

export interface SendMessageResult {
  id: string;
  mentionResults: MentionResult[];
}

/**
 * Row in `model_capabilities`. Scores are 1..5 integer ratings per domain,
 * tier is the hard lower bound the dispatcher clears before considering
 * `costPerMtokOut` to pick the cheapest qualifying model.
 *
 * Composite primary key `(provider, modelId)` — the same modelId can
 * legitimately ship under multiple providers (e.g. an Anthropic-compatible
 * endpoint that serves Claude via a Fireworks proxy).
 */
export interface ModelCapability {
  provider: string;
  modelId: string;
  reasoning: number;
  coding: number;
  writing: number;
  tier: "trivial" | "standard" | "hard";
  costPerMtokOut: number;
  updatedAt: string;
}

