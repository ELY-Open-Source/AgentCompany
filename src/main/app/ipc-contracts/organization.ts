import { z } from "zod";
import type * as C from "../../../shared/commands";
import { APPROVAL_STATE, RISK_LEVEL, TASK_PRIORITY, TASK_STATUS, WRITING_MODE } from "../../../shared/domain";
import { IDENTITY_SOURCE, ROLE_KEY } from "../../../shared/identity-domain";

const id = z.string();
const nullableId = z.string().nullable();

export const organizationContracts = {
  bootstrapOnboarding: z.strictObject({
    companyName: z.string(), companyDescription: z.string(), employeeName: z.string(), workspacePath: z.string(),
    executionMode: z.enum(["ai_ceo", "ai_cofounder"]), autoApproveHires: z.boolean(), reviewDeliverables: z.boolean(),
    goalTitle: z.string(), goalDescription: z.string(), providerKey: z.string(), providerSecret: z.string(), providerModel: z.string(),
  }) satisfies z.ZodType<C.BootstrapOnboardingInput>,
  setActiveOrganization: z.strictObject({ orgId: id }) satisfies z.ZodType<C.SetActiveOrganizationInput>,
  setUiPreferences: z.strictObject({ theme: z.enum(["system", "light", "dark"]).optional(), language: z.enum(["en", "zh"]).optional() }) satisfies z.ZodType<C.SetUiPreferencesInput>,
  deleteOrganization: z.strictObject({ orgId: id }) satisfies z.ZodType<C.DeleteOrganizationInput>,
  createOrganization: z.strictObject({
    organizationName: z.string(), description: z.string().optional(), mission: z.string(), goal: z.string(), employeeName: z.string(),
    executionMode: z.enum(["ai_ceo", "ai_cofounder"]).optional(), autoApproveHires: z.boolean().optional(), reviewDeliverables: z.boolean().optional(),
  }) satisfies z.ZodType<C.CreateOrganizationInput>,
  createAgent: z.strictObject({
    orgId: id, name: z.string(), role: z.string(), department: z.string(), modelProviderId: nullableId, modelId: nullableId,
    budgetCents: z.number(), managerAgentId: nullableId, title: z.string().optional(), roleLevel: z.string().optional(),
    modelStrategy: z.string().optional(), workspaceId: nullableId.optional(), heartbeatEnabled: z.boolean().optional(), heartbeatIntervalSec: z.number().optional(),
  }) satisfies z.ZodType<C.CreateAgentInput>,
  updateAgent: z.strictObject({
    orgId: id, agentId: id, name: z.string().optional(), role: z.string(), title: z.string(), roleLevel: z.string(), department: z.string(),
    budgetCents: z.number(), modelProviderId: nullableId, modelId: nullableId,
    avatarEmoji: z.string().optional(), avatarColor: z.string().optional(), avatarImage: z.string().optional(),
  }) satisfies z.ZodType<C.UpdateAgentInput>,
  updateEmployeeProfile: z.strictObject({
    orgId: id, employeeId: id, displayName: z.string(), avatarEmoji: z.string().optional(), avatarColor: z.string().optional(), avatarImage: z.string().optional(),
  }) satisfies z.ZodType<C.UpdateEmployeeProfileInput>,
  setAutonomousPaused: z.strictObject({ paused: z.boolean() }) satisfies z.ZodType<C.SetAutonomousPausedInput>,
  stopRun: z.strictObject({ runId: id }) satisfies z.ZodType<C.StopRunInput>,
  createTask: z.strictObject({
    orgId: id, title: z.string(), description: z.string(), status: z.enum(TASK_STATUS), assigneeAgentId: nullableId, risk: z.enum(RISK_LEVEL),
    projectId: nullableId, goalId: nullableId, workspaceId: nullableId, priority: z.enum(TASK_PRIORITY), requiresFilesystem: z.boolean(),
    writingMode: z.enum(WRITING_MODE).optional(), origin: z.enum(["chat_wake", "goal_review", "task_review"]).optional(),
  }) satisfies z.ZodType<C.CreateTaskInput>,
  updateTask: z.strictObject({
    orgId: id, taskId: id, title: z.string(), description: z.string(), assigneeAgentId: nullableId, risk: z.enum(RISK_LEVEL),
    priority: z.enum(TASK_PRIORITY), parentTaskId: nullableId, projectId: nullableId, goalId: nullableId, workspaceId: nullableId,
    requiresFilesystem: z.boolean(), writingMode: z.enum(WRITING_MODE),
  }) satisfies z.ZodType<C.UpdateTaskInput>,
  deleteTask: z.strictObject({ orgId: id, taskId: id }) satisfies z.ZodType<C.DeleteTaskInput>,
  updateTaskStatus: z.strictObject({ orgId: id, taskId: id, status: z.enum(TASK_STATUS) }) satisfies z.ZodType<C.UpdateTaskStatusInput>,
  runTask: z.strictObject({ orgId: id, taskId: id }) satisfies z.ZodType<C.RunTaskInput>,
  createGoal: z.strictObject({ orgId: id, title: z.string(), description: z.string(), ownerAgentId: nullableId }) satisfies z.ZodType<C.CreateGoalInput>,
  resumeGoal: z.strictObject({ orgId: id, goalId: id }) satisfies z.ZodType<C.ResumeGoalInput>,
  createProject: z.strictObject({
    orgId: id, goalId: nullableId, name: z.string(), description: z.string(), leadAgentId: nullableId,
  }) satisfies z.ZodType<C.CreateProjectInput>,
  createWorkspace: z.strictObject({ orgId: id, name: z.string(), localPath: z.string(), projectId: nullableId }) satisfies z.ZodType<C.CreateWorkspaceInput>,
  createApproval: z.strictObject({
    orgId: id, kind: z.string(), title: z.string(), details: z.string(), risk: z.enum(RISK_LEVEL),
    requestedByType: z.enum(["employee", "agent", "system"]), requestedById: nullableId,
  }) satisfies z.ZodType<C.CreateApprovalInput>,
  decideApproval: z.strictObject({
    orgId: id, approvalId: id, state: z.enum([APPROVAL_STATE.APPROVED, APPROVAL_STATE.DECLINED]), decidedByEmployeeId: id, notes: z.string().optional(),
  }) satisfies z.ZodType<C.DecideApprovalInput>,
  syncEmployeeIdentity: z.strictObject({
    orgId: id, employeeId: id, source: z.enum(IDENTITY_SOURCE), externalSubject: z.string(), email: z.string().nullable(),
  }) satisfies z.ZodType<C.SyncEmployeeIdentityInput>,
  grantRole: z.strictObject({
    orgId: id, principalType: z.enum(["employee", "agent", "service_identity"]), principalId: id, roleKey: z.enum(ROLE_KEY),
    scopeType: z.enum(["organization", "workspace", "project", "department"]), scopeId: id, grantedByEmployeeId: id,
  }) satisfies z.ZodType<C.GrantRoleInput>,
};
