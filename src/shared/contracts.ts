import { z } from "zod";
import type { AgentMessageRecord, AgentMetrics, BrowserActionRecord, CommentRecord, CompanyMetrics, DesktopEvent, InboxItem, OnboardingBootstrapResult, ProfileSnapshot, RunLogChunk, StandupReport } from "./types";

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
  requestHire: "agent-company:request-hire",
  saveGoal: "agent-company:save-goal",
  saveProject: "agent-company:save-project",
  saveTask: "agent-company:save-task",
  requestApproval: "agent-company:request-approval",
  decideApproval: "agent-company:decide-approval",
  saveSecret: "agent-company:save-secret",
  startTaskRun: "agent-company:start-task-run",
  cancelRun: "agent-company:cancel-run",
  getRunLog: "agent-company:get-run-log",
  getRunLogChunk: "agent-company:get-run-log-chunk",
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
  openConnectorAuthTerminal: "agent-company:open-connector-auth-terminal",
  addComment: "agent-company:add-comment",
  listComments: "agent-company:list-comments",
  setHeartbeat: "agent-company:set-heartbeat",
  triggerHeartbeat: "agent-company:trigger-heartbeat",
  getApiPort: "agent-company:get-api-port",
  rendererEvent: "agent-company:event",
  getInbox: "agent-company:get-inbox",
  getCompanyMetrics: "agent-company:get-company-metrics",
  getAgentMetrics: "agent-company:get-agent-metrics",
  getStandupReport: "agent-company:get-standup-report",
  bootstrapOnboarding: "agent-company:bootstrap-onboarding",
  saveSocialAccount: "agent-company:save-social-account",
  deleteSocialAccount: "agent-company:delete-social-account",
  listBrowserActions: "agent-company:list-browser-actions",
  cancelBrowserAction: "agent-company:cancel-browser-action",
  triggerBrowserLogin: "agent-company:trigger-browser-login",
  saveMeeting: "agent-company:save-meeting",
  deleteMeeting: "agent-company:delete-meeting",
  saveDocument: "agent-company:save-document",
  deleteDocument: "agent-company:delete-document",
  saveKnowledgeEntry: "agent-company:save-knowledge-entry",
  deleteKnowledgeEntry: "agent-company:delete-knowledge-entry",
  saveSprint: "agent-company:save-sprint",
  deleteSprint: "agent-company:delete-sprint",
  saveAutomationRule: "agent-company:save-automation-rule",
  deleteAutomationRule: "agent-company:delete-automation-rule",
  toggleAutomationRule: "agent-company:toggle-automation-rule",
  getAutomationLog: "agent-company:get-automation-log",
  sendAgentMessage: "agent-company:send-agent-message",
  listAgentMessages: "agent-company:list-agent-messages",
  markMessageRead: "agent-company:mark-message-read",
  saveWorkflow: "agent-company:save-workflow",
  deleteWorkflow: "agent-company:delete-workflow",
  runWorkflow: "agent-company:run-workflow",
  autoAssignTask: "agent-company:auto-assign-task",
  searchMessages: "agent-company:search-messages",
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
  autoApproveHires: z.boolean().default(false),
  reviewDeliverables: z.boolean().default(false),
});

export const connectorInputSchema = z.object({
  id: z.enum(["codex_local", "claude_local", "gemini_local"]),
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
  department: z.enum(["executive", "engineering", "product", "marketing", "sales", "hr", "finance", "legal", "operations", "customer_support", "research", "design"]).nullable().optional(),
  reportsTo: optionalId,
  connectorId: connectorInputSchema.shape.id,
  workspaceId: optionalId,
  model: z.string().nullable().optional(),
  metadataJson: z.string().default("{}").optional(),
  capabilities: z.string().default(""),
  budgetMonthlyUsd: z.number().min(0).default(0),
  status: z.enum(["idle", "active", "running", "paused", "error", "pending_approval", "terminated"]).default("idle"),
});

export const hireRequestSchema = z.object({
  companyId: z.string().uuid(),
  requestedByAgentId: optionalId,
  name: z.string().min(2).max(80),
  role: z.string().min(2).max(80),
  title: z.string().default(""),
  department: z.enum(["executive", "engineering", "product", "marketing", "sales", "hr", "finance", "legal", "operations", "customer_support", "research", "design"]).nullable().optional(),
  reportsTo: optionalId,
  connectorId: connectorInputSchema.shape.id,
  workspaceId: optionalId,
  model: z.string().nullable().optional(),
  metadataJson: z.string().default("{}").optional(),
  capabilities: z.string().default(""),
  budgetMonthlyUsd: z.number().min(0).default(0),
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
  relatedAgentId: optionalId,
  type: z.enum(["hire_agent", "approve_ceo_strategy", "dangerous_command", "secret_access", "budget_request", "promotion", "termination", "vendor_approval", "document_review", "production_deploy", "incident_escalation", "social_post", "deliverable_review"]),
  payloadSummary: z.string().min(2).max(280),
  impactSummary: z.string().min(2).max(400),
  payloadJson: z.string().nullable().optional(),
});

export const approvalDecisionSchema = z.object({
  companyId: z.string().uuid(),
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
  companyId: z.string().uuid(),
  taskId: z.string().uuid(),
});

export const cancelRunSchema = z.object({
  companyId: z.string().uuid(),
  runId: z.string().uuid(),
});

export const runLogSchema = z.object({
  companyId: z.string().uuid(),
  runId: z.string().uuid(),
});

export const runLogChunkSchema = z.object({
  companyId: z.string().uuid(),
  runId: z.string().uuid(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1024).max(262_144).default(65_536),
});

export const triggerBrowserLoginSchema = z.object({
  companyId: z.string().uuid(),
  socialAccountId: z.string().uuid(),
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
  unreadMessages: z.number(),
});
export type SidebarBadges = z.infer<typeof sidebarBadgesSchema>;

export const settingsSchema = z.object({
  theme: z.enum(["system", "light", "dark"]).optional(),
  locale: z.enum(["en", "zh"]).optional(),
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
  companyId: z.string().uuid(),
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
  trigger: z.enum(["manual", "timer", "assignment", "goal_activated", "approval_resolved", "subtask_completed", "comment", "report_blocked", "report_failed", "recovery", "message", "peer_request", "task_continuation"]).default("manual"),
});

export const metricsQuerySchema = z.object({
  companyId: z.string().uuid(),
  agentId: z.string().uuid().optional(),
  days: z.number().int().min(1).max(90).default(30),
});

export const bootstrapOnboardingSchema = z.object({
  companyName: z.string().min(2).max(80),
  companyDescription: z.string().max(500).default(""),
  workspacePath: z.string().default(""),
  autoApproveHires: z.boolean().default(true),
  reviewDeliverables: z.boolean().default(false),
  goalTitle: z.string().default(""),
  goalDescription: z.string().default(""),
  connectorId: z.enum(["codex_local", "claude_local", "gemini_local"]).optional(),
});

export const socialAccountInputSchema = z.object({
  id: optionalId,
  companyId: z.string().uuid(),
  platform: z.enum(["twitter", "linkedin", "instagram", "facebook", "reddit", "youtube", "tiktok", "bluesky", "other"]),
  accountName: z.string().min(1).max(120),
  displayName: z.string().max(120).default(""),
  profileUrl: z.string().max(500).default(""),
  credentialSecretId: optionalId,
  status: z.enum(["active", "logged_in", "login_required", "suspended", "paused"]).default("login_required"),
  requireApproval: z.boolean().default(true),
  metadataJson: z.string().default("{}"),
});

export const meetingInputSchema = z.object({
  id: optionalId,
  companyId: z.string().uuid(),
  type: z.enum(["standup", "sprint_planning", "sprint_review", "retrospective", "one_on_one", "all_hands", "department_sync", "incident_review", "hiring_committee", "budget_review", "design_review", "architecture_review"]),
  title: z.string().min(2).max(160),
  organizerAgentId: optionalId,
  participantAgentIds: z.string().default("[]"),
  scheduledAt: z.string(),
  durationMinutes: z.number().int().min(5).max(480).default(30),
  agendaJson: z.string().default("[]"),
  notesJson: z.string().default("[]"),
  decisionsJson: z.string().default("[]"),
  actionItemsJson: z.string().default("[]"),
  status: z.enum(["scheduled", "in_progress", "completed", "cancelled"]).default("scheduled"),
});

export const documentInputSchema = z.object({
  id: optionalId,
  companyId: z.string().uuid(),
  type: z.enum(["prd", "technical_spec", "design_doc", "test_plan", "post_mortem", "meeting_notes", "budget_proposal", "hiring_requisition", "performance_review_doc", "sop", "knowledge_article", "project_brief", "sprint_report", "incident_report", "onboarding_guide", "architecture_decision", "status_report", "contract", "proposal"]),
  title: z.string().min(2).max(200),
  content: z.string().default(""),
  authorAgentId: optionalId,
  reviewerAgentId: optionalId,
  projectId: optionalId,
  goalId: optionalId,
  parentDocId: optionalId,
  version: z.number().int().min(1).default(1),
  status: z.enum(["draft", "in_review", "approved", "archived", "superseded"]).default("draft"),
  tagsJson: z.string().default("[]"),
});

export const knowledgeEntryInputSchema = z.object({
  id: optionalId,
  companyId: z.string().uuid(),
  category: z.enum(["lesson_learned", "best_practice", "decision", "process", "technical", "business", "onboarding", "incident"]),
  topic: z.string().min(2).max(200),
  content: z.string().min(1),
  authorAgentId: optionalId,
  importance: z.enum(["critical", "high", "medium", "low"]).default("medium"),
  tagsJson: z.string().default("[]"),
  referencedEntityType: z.enum([
    "agents",
    "goals",
    "projects",
    "tasks",
    "approvals",
    "runs",
    "secrets",
    "meetings",
    "documents",
    "knowledge_base",
    "sprints",
    "automation_rules",
    "workflow_pipelines",
  ]).nullable().optional(),
  referencedEntityId: z.string().nullable().optional(),
});

export const sprintInputSchema = z.object({
  id: optionalId,
  companyId: z.string().uuid(),
  name: z.string().min(2).max(120),
  goal: z.string().default(""),
  startDate: z.string(),
  endDate: z.string(),
  status: z.enum(["planning", "active", "review", "completed", "cancelled"]).default("planning"),
  retrospectiveNotes: z.string().default(""),
  velocityPoints: z.number().int().min(0).default(0),
  completedPoints: z.number().int().min(0).default(0),
});

export const browserActionQuerySchema = z.object({
  companyId: z.string().uuid(),
  socialAccountId: z.string().uuid().optional(),
  status: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const cancelBrowserActionSchema = z.object({
  actionId: z.string().uuid(),
  companyId: z.string().uuid(),
});

export const automationRuleInputSchema = z.object({
  id: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable().optional()),
  companyId: z.string().uuid(),
  name: z.string().min(2).max(120),
  description: z.string().max(500).default(""),
  trigger: z.enum([
    "task_status_changed", "task_created", "task_blocked", "task_reassigned",
    "run_completed", "run_failed", "approval_created", "approval_resolved",
    "budget_threshold", "agent_idle", "comment_posted", "document_created",
    "schedule", "hire_approved", "sprint_started", "sprint_ended",
  ]),
  conditionsJson: z.string().default("{}"),
  action: z.enum([
    "assign_task", "create_task", "notify_agent", "send_message",
    "trigger_heartbeat", "create_approval", "update_task_status",
    "escalate_to_manager", "cross_department_notify", "schedule_meeting",
    "create_document", "auto_approve", "reassign_task", "run_task",
  ]),
  actionConfigJson: z.string().default("{}"),
  sourceDepartment: z.enum([
    "executive", "engineering", "product", "marketing", "sales",
    "hr", "finance", "legal", "operations", "customer_support", "research", "design",
  ]).nullable().optional(),
  targetDepartment: z.enum([
    "executive", "engineering", "product", "marketing", "sales",
    "hr", "finance", "legal", "operations", "customer_support", "research", "design",
  ]).nullable().optional(),
  priority: z.number().int().min(0).max(100).default(50),
  status: z.enum(["active", "paused", "disabled", "error"]).default("active"),
});

export const agentMessageInputSchema = z.object({
  companyId: z.string().uuid(),
  fromAgentId: z.string().uuid(),
  toAgentId: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable().optional()),
  channel: z.enum(["direct", "department", "company", "project", "incident"]).default("direct"),
  channelTargetId: z.string().nullable().optional(),
  subject: z.preprocess((v) => (v === "" ? "(no subject)" : v), z.string().min(1).max(200)),
  body: z.string().min(1).max(8000),
  priority: z.enum(["urgent", "normal", "low"]).default("normal"),
  parentMessageId: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable().optional()),
  attachmentsJson: z.string().default("[]"),
}).superRefine((value, ctx) => {
  if (value.channel === "direct" && !value.toAgentId) {
    ctx.addIssue({
      path: ["toAgentId"],
      code: z.ZodIssueCode.custom,
      message: "Direct messages require toAgentId.",
    });
  }

  if ((value.channel === "department" || value.channel === "project") && !value.channelTargetId) {
    ctx.addIssue({
      path: ["channelTargetId"],
      code: z.ZodIssueCode.custom,
      message: `${value.channel} messages require channelTargetId.`,
    });
  }

  if (value.channel !== "direct" && value.toAgentId) {
    ctx.addIssue({
      path: ["toAgentId"],
      code: z.ZodIssueCode.custom,
      message: "Only direct messages may set toAgentId.",
    });
  }
});

export const messageQuerySchema = z.object({
  companyId: z.string().uuid(),
  agentId: z.string().uuid().optional(),
  channel: z.enum(["direct", "department", "company", "project", "incident"]).optional(),
  channelTargetId: z.string().nullable().optional(),
  unreadOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).default(200),
});

export const searchMessagesSchema = z.object({
  companyId: z.string().uuid(),
  query: z.string().min(1).max(200),
  channel: z.enum(["direct", "department", "company", "project", "incident"]).optional(),
  channelTargetId: z.string().nullable().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const workflowInputSchema = z.object({
  id: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable().optional()),
  companyId: z.string().uuid(),
  name: z.string().min(2).max(120),
  description: z.string().max(500).default(""),
  stepsJson: z.string().default("[]"),
  triggerType: z.enum([
    "task_status_changed", "task_created", "task_blocked", "task_reassigned",
    "run_completed", "run_failed", "approval_created", "approval_resolved",
    "budget_threshold", "agent_idle", "comment_posted", "document_created",
    "schedule", "hire_approved", "sprint_started", "sprint_ended",
  ]),
  triggerConfigJson: z.string().default("{}"),
  status: z.enum(["draft", "active", "paused", "completed", "failed"]).default("draft"),
});

export const toggleAutomationRuleSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  status: z.enum(["active", "paused"]),
});

export const markMessageReadSchema = z.object({
  messageId: z.string().uuid(),
  companyId: z.string().uuid(),
  readerAgentId: optionalId,
});

export const runWorkflowSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
});

export const autoAssignSchema = z.object({
  taskId: z.string().uuid(),
  companyId: z.string().uuid(),
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
  requestHire: (input: z.infer<typeof hireRequestSchema>) => Promise<DesktopResult<{ agentId: string; approvalId: string; autoApproved: boolean }>>;
  saveGoal: (input: z.infer<typeof goalInputSchema>) => Promise<DesktopResult<string>>;
  saveProject: (input: z.infer<typeof projectInputSchema>) => Promise<DesktopResult<string>>;
  saveTask: (input: z.infer<typeof taskInputSchema>) => Promise<DesktopResult<string>>;
  requestApproval: (input: z.infer<typeof approvalInputSchema>) => Promise<DesktopResult<string>>;
  decideApproval: (input: z.infer<typeof approvalDecisionSchema>) => Promise<DesktopResult<boolean>>;
  saveSecret: (input: z.infer<typeof secretInputSchema>) => Promise<DesktopResult<string>>;
  startTaskRun: (input: z.infer<typeof startRunSchema>) => Promise<DesktopResult<string>>;
  cancelRun: (input: z.infer<typeof cancelRunSchema>) => Promise<DesktopResult<boolean>>;
  getRunLog: (input: z.infer<typeof runLogSchema>) => Promise<DesktopResult<string>>;
  getRunLogChunk: (input: z.infer<typeof runLogChunkSchema>) => Promise<DesktopResult<RunLogChunk>>;
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
  openConnectorAuthTerminal: (connectorId: z.infer<typeof connectorInputSchema.shape.id>) => Promise<DesktopResult<boolean>>;
  addComment: (input: z.infer<typeof commentInputSchema>) => Promise<DesktopResult<string>>;
  listComments: (input: z.infer<typeof listCommentsSchema>) => Promise<DesktopResult<CommentRecord[]>>;
  setHeartbeat: (input: z.infer<typeof heartbeatSettingsSchema>) => Promise<DesktopResult<boolean>>;
  triggerHeartbeat: (input: z.infer<typeof triggerHeartbeatSchema>) => Promise<DesktopResult<string>>;
  getApiPort: () => Promise<DesktopResult<number>>;
  getInbox: (companyId: string) => Promise<DesktopResult<InboxItem[]>>;
  getCompanyMetrics: (input: z.infer<typeof metricsQuerySchema>) => Promise<DesktopResult<CompanyMetrics>>;
  getAgentMetrics: (input: z.infer<typeof metricsQuerySchema>) => Promise<DesktopResult<AgentMetrics>>;
  getStandupReport: (companyId: string) => Promise<DesktopResult<StandupReport>>;
  bootstrapOnboarding: (input: z.infer<typeof bootstrapOnboardingSchema>) => Promise<DesktopResult<OnboardingBootstrapResult>>;
  saveSocialAccount: (input: z.infer<typeof socialAccountInputSchema>) => Promise<DesktopResult<string>>;
  deleteSocialAccount: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  listBrowserActions: (input: z.infer<typeof browserActionQuerySchema>) => Promise<DesktopResult<BrowserActionRecord[]>>;
  cancelBrowserAction: (input: z.infer<typeof cancelBrowserActionSchema>) => Promise<DesktopResult<boolean>>;
  triggerBrowserLogin: (input: z.infer<typeof triggerBrowserLoginSchema>) => Promise<DesktopResult<boolean>>;
  saveMeeting: (input: z.infer<typeof meetingInputSchema>) => Promise<DesktopResult<string>>;
  deleteMeeting: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  saveDocument: (input: z.infer<typeof documentInputSchema>) => Promise<DesktopResult<string>>;
  deleteDocument: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  saveKnowledgeEntry: (input: z.infer<typeof knowledgeEntryInputSchema>) => Promise<DesktopResult<string>>;
  deleteKnowledgeEntry: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  saveSprint: (input: z.infer<typeof sprintInputSchema>) => Promise<DesktopResult<string>>;
  deleteSprint: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  saveAutomationRule: (input: z.infer<typeof automationRuleInputSchema>) => Promise<DesktopResult<string>>;
  deleteAutomationRule: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  toggleAutomationRule: (input: z.infer<typeof toggleAutomationRuleSchema>) => Promise<DesktopResult<boolean>>;
  getAutomationLog: (companyId: string) => Promise<DesktopResult<Array<{ ruleId: string; ruleName: string; trigger: string; action: string; executedAt: string }>>>;
  sendAgentMessage: (input: z.infer<typeof agentMessageInputSchema>) => Promise<DesktopResult<string>>;
  listAgentMessages: (input: z.infer<typeof messageQuerySchema>) => Promise<DesktopResult<AgentMessageRecord[]>>;
  markMessageRead: (input: z.infer<typeof markMessageReadSchema>) => Promise<DesktopResult<boolean>>;
  saveWorkflow: (input: z.infer<typeof workflowInputSchema>) => Promise<DesktopResult<string>>;
  deleteWorkflow: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  runWorkflow: (input: z.infer<typeof runWorkflowSchema>) => Promise<DesktopResult<boolean>>;
  autoAssignTask: (input: z.infer<typeof autoAssignSchema>) => Promise<DesktopResult<string>>;
  searchMessages: (input: z.infer<typeof searchMessagesSchema>) => Promise<DesktopResult<AgentMessageRecord[]>>;
  recoveryRetry: (taskId: string, agentId: string, companyId: string) => Promise<DesktopResult<null>>;
  recoveryDismiss: (taskId: string) => Promise<DesktopResult<null>>;
  recoveryFail: (taskId: string) => Promise<DesktopResult<null>>;
  subscribe: (callback: (event: DesktopEvent) => void) => () => void;
};
