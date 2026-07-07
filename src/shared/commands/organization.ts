import type { ApprovalState, IdentitySource, PrincipalType, RiskLevel, RoleKey, TaskPriority, TaskStatus, UiLanguage, UiTheme } from "../domain";

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
  role: string;
  title: string;
  roleLevel: string;
  department: string;
  budgetCents: number;
  modelProviderId: string | null;
  modelId: string | null;
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
