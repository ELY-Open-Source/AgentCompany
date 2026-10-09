import type { ApprovalState, IdentitySource, PrincipalType, RiskLevel, RoleKey, TaskPriority, TaskStatus, UiLanguage, UiTheme, WritingMode } from "../domain";

export interface SetActiveOrganizationInput {
  orgId: string;
}

export interface SetUiPreferencesInput {
  theme?: UiTheme;
  language?: UiLanguage;
}

export interface DeleteOrganizationInput {
  orgId: string;
}

export interface CreateOrganizationInput {
  organizationName: string;
  description?: string;
  mission: string;
  goal: string;
  employeeName: string;
  executionMode?: "ai_ceo" | "ai_cofounder";
  autoApproveHires?: boolean;
  reviewDeliverables?: boolean;
}

export interface UpdateAgentInput {
  orgId: string;
  agentId: string;
  /** New display name; omit to keep the current one. */
  name?: string;
  role: string;
  title: string;
  roleLevel: string;
  department: string;
  budgetCents: number;
  modelProviderId: string | null;
  modelId: string | null;
  /** Emoji shown on the avatar tile; empty string clears it. */
  avatarEmoji?: string;
  /** Background color for the avatar tile; empty string clears it. */
  avatarColor?: string;
  /** data:image/... portrait (already downscaled); empty string clears it. */
  avatarImage?: string;
}

export interface SetAutonomousPausedInput {
  paused: boolean;
}

export interface StopRunInput {
  runId: string;
}

export interface UpdateEmployeeProfileInput {
  orgId: string;
  employeeId: string;
  displayName: string;
  avatarEmoji?: string;
  avatarColor?: string;
  avatarImage?: string;
}

export interface CreateAgentInput {
  orgId: string;
  name: string;
  role: string;
  department: string;
  modelProviderId: string | null;
  modelId: string | null;
  budgetCents: number;
  managerAgentId: string | null;
  title?: string;
  roleLevel?: string;
  modelStrategy?: string;
  workspaceId?: string | null;
  heartbeatEnabled?: boolean;
  heartbeatIntervalSec?: number;
}

export interface CreateTaskInput {
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
  requiresFilesystem: boolean;
  /** Defaults to conversational. */
  writingMode?: WritingMode;
  /** Provenance: 'chat_wake' for mention-wake vehicles, 'goal_review' for CEO goal checkpoints, 'task_review' for a manager's review of work, omitted for plain work. */
  origin?: "chat_wake" | "goal_review" | "task_review";
}

export interface UpdateTaskStatusInput {
  orgId: string;
  taskId: string;
  status: TaskStatus;
}

export interface RunTaskInput {
  orgId: string;
  taskId: string;
}

export interface UpdateTaskInput {
  orgId: string;
  taskId: string;
  title: string;
  description: string;
  assigneeAgentId: string | null;
  risk: RiskLevel;
  priority: TaskPriority;
  parentTaskId: string | null;
  projectId: string | null;
  goalId: string | null;
  workspaceId: string | null;
  requiresFilesystem: boolean;
  writingMode: WritingMode;
}

export interface SetTaskBlockedInput {
  orgId: string;
  taskId: string;
  /** Why the task is blocked; null unblocks it. */
  reason: string | null;
}

export interface DeleteTaskInput {
  orgId: string;
  taskId: string;
}

export interface CreateGoalInput {
  orgId: string;
  title: string;
  description: string;
  ownerAgentId: string | null;
  /** When the goal is planned to be reached; omitted means no target date. */
  dueAt?: string | null;
}

/** The company's profile and how it runs, as set after onboarding; changes apply to work from now on. */
export interface UpdateOrganizationInput {
  orgId: string;
  name: string;
  description: string;
  mission: string;
  goal: string;
  executionMode: "ai_ceo" | "ai_cofounder";
  autoApproveHires: boolean;
  reviewDeliverables: boolean;
}

export interface SetGoalDueDateInput {
  orgId: string;
  goalId: string;
  /** ISO time the goal is planned to be reached, or null to clear it. */
  dueAt: string | null;
}

export interface CreateProjectInput {
  orgId: string;
  goalId: string | null;
  name: string;
  description: string;
  leadAgentId: string | null;
}

export interface CreateWorkspaceInput {
  orgId: string;
  name: string;
  localPath: string;
  projectId: string | null;
}

export interface CreateApprovalInput {
  orgId: string;
  kind: string;
  title: string;
  details: string;
  risk: RiskLevel;
  requestedByType: "employee" | "agent" | "system";
  requestedById: string | null;
}

export interface DecideApprovalInput {
  orgId: string;
  approvalId: string;
  state: Extract<ApprovalState, "approved" | "declined">;
  decidedByEmployeeId: string;
  notes?: string;
}

export interface SyncEmployeeIdentityInput {
  orgId: string;
  employeeId: string;
  source: IdentitySource;
  externalSubject: string;
  email: string | null;
}

export interface GrantRoleInput {
  orgId: string;
  principalType: PrincipalType;
  principalId: string;
  roleKey: RoleKey;
  scopeType: "organization" | "workspace" | "project" | "department";
  scopeId: string;
  grantedByEmployeeId: string;
}
