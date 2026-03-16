import { z } from "zod";
import type { CommentRecord, DesktopEvent, ProfileSnapshot } from "./types";

export const IPC_CHANNELS = {
  loadSnapshot: "agent-company:load-snapshot",
  pickDirectory: "agent-company:pick-directory",
  openPath: "agent-company:open-path",
  saveCompany: "agent-company:save-company",
  setCurrentCompany: "agent-company:set-current-company",
  saveConnector: "agent-company:save-connector",
  testConnector: "agent-company:test-connector",
  saveWorkspace: "agent-company:save-workspace",
  saveAgent: "agent-company:save-agent",
  saveGoal: "agent-company:save-goal",
  saveProject: "agent-company:save-project",
  saveTask: "agent-company:save-task",
  requestApproval: "agent-company:request-approval",
  decideApproval: "agent-company:decide-approval",
  saveSecret: "agent-company:save-secret",
  startTaskRun: "agent-company:start-task-run",
  cancelRun: "agent-company:cancel-run",
  getRunLog: "agent-company:get-run-log",
  backupProfile: "agent-company:backup-profile",
  restoreProfile: "agent-company:restore-profile",
  updateSettings: "agent-company:update-settings",
  checkForUpdates: "agent-company:check-for-updates",
  deleteCompany: "agent-company:delete-company",
  deleteAgent: "agent-company:delete-agent",
  deleteTask: "agent-company:delete-task",
  deleteGoal: "agent-company:delete-goal",
  deleteProject: "agent-company:delete-project",
  deleteWorkspace: "agent-company:delete-workspace",
  deleteApproval: "agent-company:delete-approval",
  deleteSecret: "agent-company:delete-secret",
  getSidebarBadges: "agent-company:get-sidebar-badges",
  listConnectorModels: "agent-company:list-connector-models",
  addComment: "agent-company:add-comment",
  listComments: "agent-company:list-comments",
  setHeartbeat: "agent-company:set-heartbeat",
  triggerHeartbeat: "agent-company:trigger-heartbeat",
  getApiPort: "agent-company:get-api-port",
  rendererEvent: "agent-company:event",
} as const;

const optionalId = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().uuid().nullable().optional(),
);

export const companyInputSchema = z.object({
  id: optionalId,
  name: z.string().min(2).max(80),
  description: z.string().max(500).default(""),
  status: z.enum(["active", "paused", "archived"]).default("active"),
});

export const connectorInputSchema = z.object({
  id: z.enum(["codex_local", "claude_local", "gemini_local", "opencode_local", "kimi_local"]),
  command: z.string().min(1),
  model: z.string().nullable().optional(),
  envBindingText: z.string().default(""),
  notes: z.string().default(""),
});

export const workspaceInputSchema = z.object({
  id: optionalId,
  companyId: z.string().uuid(),
  name: z.string().min(2).max(80),
  localPath: z.string().min(1),
  repoUrl: z.string().default(""),
  repoRef: z.string().default(""),
  projectId: optionalId,
  isPrimary: z.boolean().default(false),
});

export const agentInputSchema = z.object({
  id: optionalId,
  companyId: z.string().uuid(),
  name: z.string().min(2).max(80),
  role: z.string().min(2).max(80),
  title: z.string().default(""),
  reportsTo: optionalId,
  connectorId: connectorInputSchema.shape.id,
  workspaceId: optionalId,
  model: z.string().nullable().optional(),
  metadataJson: z.string().default("{}").optional(),
  capabilities: z.string().default(""),
  budgetMonthlyUsd: z.number().min(0).default(0),
  status: z.enum(["idle", "active", "running", "paused", "error", "pending_approval", "terminated"]).default("idle"),
});

export const goalInputSchema = z.object({
  id: optionalId,
  companyId: z.string().uuid(),
  title: z.string().min(2).max(120),
  description: z.string().default(""),
  parentId: optionalId,
  ownerAgentId: optionalId,
  status: z.enum(["planned", "active", "achieved", "cancelled"]).default("planned"),
});

export const projectInputSchema = z.object({
  id: optionalId,
  companyId: z.string().uuid(),
  goalId: optionalId,
  name: z.string().min(2).max(120),
  description: z.string().default(""),
  leadAgentId: optionalId,
  targetDate: z.string().nullable().optional(),
  status: z.enum(["backlog", "planned", "in_progress", "completed", "cancelled"]).default("planned"),
});

export const taskInputSchema = z.object({
  id: optionalId,
  companyId: z.string().uuid(),
  projectId: optionalId,
  goalId: optionalId,
  parentId: optionalId,
  title: z.string().min(2).max(160),
  description: z.string().default(""),
  assigneeAgentId: optionalId,
  workspaceId: optionalId,
  priority: z.enum(["critical", "high", "medium", "low"]).default("medium"),
  status: z.enum(["backlog", "todo", "in_progress", "in_review", "done", "blocked", "cancelled"]).default("todo"),
});

export const approvalInputSchema = z.object({
  companyId: z.string().uuid(),
  relatedTaskId: optionalId,
  requestedByAgentId: optionalId,
  type: z.enum(["hire_agent", "approve_ceo_strategy", "dangerous_command", "secret_access"]),
  payloadSummary: z.string().min(2).max(280),
  impactSummary: z.string().min(2).max(400),
});

export const approvalDecisionSchema = z.object({
  approvalId: z.string().uuid(),
  state: z.enum(["approved", "rejected", "revision_requested"]),
  decisionNote: z.string().max(400).default(""),
});

export const secretInputSchema = z.object({
  id: optionalId,
  companyId: z.string().uuid(),
  name: z.string().min(2).max(80),
  description: z.string().default(""),
  value: z.string().min(1).max(2000),
});

export const startRunSchema = z.object({
  taskId: z.string().uuid(),
});

export const cancelRunSchema = z.object({
  runId: z.string().uuid(),
});

export const runLogSchema = z.object({
  runId: z.string().uuid(),
});

export const deleteEntitySchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
});

export const sidebarBadgesSchema = z.object({
  pendingApprovals: z.number(),
  activeRuns: z.number(),
  failedRuns: z.number(),
  todoTasks: z.number(),
  budgetWarnings: z.number(),
});
export type SidebarBadges = z.infer<typeof sidebarBadgesSchema>;

export const settingsSchema = z.object({
  theme: z.enum(["system", "light", "dark"]).optional(),
  updatesEnabled: z.boolean().optional(),
  logRetentionDays: z.number().int().min(1).max(365).optional(),
});

export const commentInputSchema = z.object({
  companyId: z.string().uuid(),
  taskId: z.string().uuid(),
  authorAgentId: optionalId,
  authorName: z.string().min(1).max(80),
  body: z.string().min(1).max(4000),
});

export const listCommentsSchema = z.object({
  taskId: z.string().uuid(),
});

export const heartbeatSettingsSchema = z.object({
  agentId: z.string().uuid(),
  companyId: z.string().uuid(),
  enabled: z.boolean(),
  intervalSec: z.number().int().min(30).max(86400).default(120),
});

export const triggerHeartbeatSchema = z.object({
  agentId: z.string().uuid(),
  companyId: z.string().uuid(),
  trigger: z.enum(["manual", "timer", "assignment", "goal_activated", "approval_resolved", "subtask_completed", "comment", "report_blocked", "report_failed", "recovery"]).default("manual"),
});

export type DesktopResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export type DesktopApi = {
  loadSnapshot: () => Promise<DesktopResult<ProfileSnapshot>>;
  pickDirectory: () => Promise<DesktopResult<string | null>>;
  openPath: (targetPath: string) => Promise<DesktopResult<boolean>>;
  saveCompany: (input: z.infer<typeof companyInputSchema>) => Promise<DesktopResult<string>>;
  setCurrentCompany: (companyId: string) => Promise<DesktopResult<boolean>>;
  saveConnector: (input: z.infer<typeof connectorInputSchema>) => Promise<DesktopResult<boolean>>;
  testConnector: (id: z.infer<typeof connectorInputSchema.shape.id>) => Promise<DesktopResult<boolean>>;
  saveWorkspace: (input: z.infer<typeof workspaceInputSchema>) => Promise<DesktopResult<string>>;
  saveAgent: (input: z.infer<typeof agentInputSchema>) => Promise<DesktopResult<string>>;
  saveGoal: (input: z.infer<typeof goalInputSchema>) => Promise<DesktopResult<string>>;
  saveProject: (input: z.infer<typeof projectInputSchema>) => Promise<DesktopResult<string>>;
  saveTask: (input: z.infer<typeof taskInputSchema>) => Promise<DesktopResult<string>>;
  requestApproval: (input: z.infer<typeof approvalInputSchema>) => Promise<DesktopResult<string>>;
  decideApproval: (input: z.infer<typeof approvalDecisionSchema>) => Promise<DesktopResult<boolean>>;
  saveSecret: (input: z.infer<typeof secretInputSchema>) => Promise<DesktopResult<string>>;
  startTaskRun: (input: z.infer<typeof startRunSchema>) => Promise<DesktopResult<string>>;
  cancelRun: (input: z.infer<typeof cancelRunSchema>) => Promise<DesktopResult<boolean>>;
  getRunLog: (input: z.infer<typeof runLogSchema>) => Promise<DesktopResult<string>>;
  backupProfile: () => Promise<DesktopResult<string | null>>;
  restoreProfile: () => Promise<DesktopResult<boolean>>;
  updateSettings: (input: z.infer<typeof settingsSchema>) => Promise<DesktopResult<boolean>>;
  checkForUpdates: () => Promise<DesktopResult<boolean>>;
  deleteCompany: (companyId: string) => Promise<DesktopResult<boolean>>;
  deleteAgent: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  deleteTask: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  deleteGoal: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  deleteProject: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  deleteWorkspace: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  deleteApproval: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  deleteSecret: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  getSidebarBadges: (companyId: string) => Promise<DesktopResult<SidebarBadges>>;
  listConnectorModels: (connectorId: string) => Promise<DesktopResult<Array<{ id: string; label: string }>>>;
  addComment: (input: z.infer<typeof commentInputSchema>) => Promise<DesktopResult<string>>;
  listComments: (input: z.infer<typeof listCommentsSchema>) => Promise<DesktopResult<CommentRecord[]>>;
  setHeartbeat: (input: z.infer<typeof heartbeatSettingsSchema>) => Promise<DesktopResult<boolean>>;
  triggerHeartbeat: (input: z.infer<typeof triggerHeartbeatSchema>) => Promise<DesktopResult<string>>;
  getApiPort: () => Promise<DesktopResult<number>>;
  subscribe: (callback: (event: DesktopEvent) => void) => () => void;
};
