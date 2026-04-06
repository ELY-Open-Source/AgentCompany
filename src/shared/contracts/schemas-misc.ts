import { z } from "zod";
import { DEPARTMENT_IDS, optionalId } from "./helpers";

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
  sourceDepartment: DEPARTMENT_IDS.nullable().optional(),
  targetDepartment: DEPARTMENT_IDS.nullable().optional(),
  priority: z.number().int().min(0).max(100).default(50),
  status: z.enum(["active", "paused", "disabled", "error"]).default("active"),
});

export const toggleAutomationRuleSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  status: z.enum(["active", "paused"]),
});

export const metricsQuerySchema = z.object({
  companyId: z.string().uuid(),
  agentId: z.string().uuid().optional(),
  days: z.number().int().min(1).max(90).default(30),
});

export const budgetPolicyInputSchema = z.object({
  id: optionalId,
  companyId: z.string().uuid(),
  scopeType: z.enum(["company", "agent", "project"]),
  scopeId: z.string().uuid(),
  metric: z.literal("billed_cents").default("billed_cents"),
  windowKind: z.literal("calendar_month_utc").default("calendar_month_utc"),
  amount: z.number().int().min(1),
  warnPercent: z.number().int().min(1).max(100).default(80),
  hardStopEnabled: z.boolean().default(true),
  notifyEnabled: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

export const listBudgetPoliciesSchema = z.object({
  companyId: z.string().uuid(),
});

export const deleteBudgetPolicySchema = z.object({
  companyId: z.string().uuid(),
  policyId: z.string().uuid(),
});

export const listBudgetIncidentsSchema = z.object({
  companyId: z.string().uuid(),
  status: z.enum(["open", "resolved", "auto_resolved_limit_increase", "auto_closed", "all"]).default("all"),
});

export const resolveBudgetIncidentSchema = z.object({
  companyId: z.string().uuid(),
  incidentId: z.string().uuid(),
});

export const getBudgetStatusSchema = z.object({
  companyId: z.string().uuid(),
});

export const wakeupQuerySchema = z.object({
  companyId: z.string().uuid(),
  status: z.enum(["queued", "claimed", "coalesced", "deferred", "completed"]).optional(),
  agentId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export interface WakeupRequestRecord {
  id: string;
  companyId: string;
  agentId: string;
  source: string;
  triggerDetail: string | null;
  status: string;
  coalescedCount: number;
  runId: string | null;
  requestedAt: string;
  claimedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const entityGetterSchema = z.object({
  companyId: z.string().uuid(),
  id: z.string().uuid(),
});

export const listConfigRevisionsSchema = z.object({
  companyId: z.string().min(1),
  agentId: z.string().min(1),
});

export const getConfigRevisionSchema = z.object({
  companyId: z.string().min(1),
  revisionId: z.string().min(1),
});

export const rollbackConfigRevisionSchema = z.object({
  companyId: z.string().min(1),
  agentId: z.string().min(1),
  revisionId: z.string().min(1),
});

export const listRunEventsSchema = z.object({
  companyId: z.string().min(1),
  runId: z.string().min(1),
  offset: z.number().optional(),
  limit: z.number().optional(),
});

export const getAgentPermissionsSchema = z.object({
  agentId: z.string().min(1),
});

export const setAgentPermissionSchema = z.object({
  companyId: z.string().min(1),
  agentId: z.string().min(1),
  permissionKey: z.string().min(1),
  enabled: z.boolean(),
});

export const heartbeatPolicySchema = z.object({
  companyId: z.string().min(1),
  agentId: z.string().min(1),
});

export const setHeartbeatPolicySchema = z.object({
  companyId: z.string().min(1),
  agentId: z.string().min(1),
  enabled: z.boolean().optional(),
  intervalSec: z.number().optional(),
  cooldownSec: z.number().optional(),
  maxConcurrentRuns: z.number().optional(),
  wakeOnDemand: z.boolean().optional(),
});

export const runtimeStateSchema = z.object({
  companyId: z.string().min(1),
  agentId: z.string().min(1),
});

export const setRuntimeStateSchema = z.object({
  companyId: z.string().min(1),
  agentId: z.string().min(1),
  state: z.record(z.string(), z.unknown()),
});

// ─── Thread Runtime Schemas ───────────────────────────────────────────────────

export const createThreadSchema = z.object({
  companyId: z.string().uuid(),
  title: z.string().min(1).max(200),
  type: z.enum(["task", "approval", "general", "announcement"]),
  relatedEntityType: z.string().nullable().optional(),
  relatedEntityId: z.string().nullable().optional(),
});

export const listThreadsSchema = z.object({
  companyId: z.string().uuid(),
  type: z.enum(["task", "approval", "general", "announcement"]).optional(),
  relatedEntityType: z.string().optional(),
  relatedEntityId: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

export const threadGetterSchema = z.object({
  companyId: z.string().uuid(),
  threadId: z.string().uuid(),
});

export const addThreadEventSchema = z.object({
  companyId: z.string().uuid(),
  threadId: z.string().uuid(),
  actorId: z.string().min(1),
  actorType: z.enum(["agent", "user", "system"]),
  eventType: z.enum(["message", "status_change", "approval_request", "approval_decision", "file_attachment", "system_note"]),
  body: z.string().default(""),
  metadataJson: z.string().default("{}"),
});

export const listThreadEventsSchema = z.object({
  companyId: z.string().uuid(),
  threadId: z.string().uuid(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

export const setThreadWaitStateSchema = z.object({
  companyId: z.string().uuid(),
  threadId: z.string().uuid(),
  waitingFor: z.enum(["user_review", "user_approval", "user_reply"]),
  relatedApprovalId: z.string().nullable().optional(),
  reason: z.string().min(1).max(500),
});

export const resolveThreadWaitStateSchema = z.object({
  companyId: z.string().uuid(),
  waitStateId: z.string().uuid(),
});

export const listThreadWaitStatesSchema = z.object({
  companyId: z.string().uuid(),
  resolvedOnly: z.boolean().default(false),
});

export const listParticipantsSchema = z.object({
  threadId: z.string().uuid(),
  companyId: z.string().uuid(),
});

export const addParticipantSchema = z.object({
  threadId: z.string().uuid(),
  companyId: z.string().uuid(),
  participantId: z.string(),
  participantType: z.enum(["agent", "user", "system"]),
  role: z.enum(["owner", "member", "observer"]).default("member"),
});

export const removeParticipantSchema = z.object({
  threadId: z.string().uuid(),
  companyId: z.string().uuid(),
  participantId: z.string(),
});

export const subscribeThreadSchema = z.object({
  threadId: z.string().uuid(),
  companyId: z.string().uuid(),
  subscriberId: z.string(),
  subscriberType: z.enum(["agent", "user", "system"]),
  notifyOn: z.enum(["all", "mentions", "none"]).default("all"),
});

export const unsubscribeThreadSchema = z.object({
  threadId: z.string().uuid(),
  companyId: z.string().uuid(),
  subscriberId: z.string(),
});

export const listSubscriptionsSchema = z.object({
  threadId: z.string().uuid(),
  companyId: z.string().uuid(),
});

export const listSubscribedThreadsSchema = z.object({
  subscriberId: z.string(),
  companyId: z.string().uuid(),
});
