/**
 * Per-action config schemas for automation rules.
 *
 * Previously `automation-actions.ts` coerced `config.x as string` at every
 * branch without runtime validation, which hid config-authoring mistakes
 * behind silent default values (e.g. a numeric `priority` landed as the
 * literal string "medium"). Each schema describes the contract of the JSON
 * stored in `automation_rules.action_config_json`; validation failures are
 * surfaced to the caller so the rule is skipped and logged.
 */

import { z } from "zod";
import { approvalTypeEnum, type AutomationAction } from "@shared/types";

const messageChannelSchema = z.enum(["direct", "department", "company", "project", "incident"]);
const messagePrioritySchema = z.enum(["urgent", "normal", "low"]);
const taskPrioritySchema = z.enum(["critical", "high", "medium", "low"]);

export const assignTaskConfigSchema = z.object({}).passthrough();

export const createTaskConfigSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  priority: taskPrioritySchema.optional(),
  assigneeAgentId: z.string().nullable().optional(),
  projectId: z.string().optional(),
  workspaceId: z.string().nullable().optional(),
  requiresFilesystem: z.boolean().default(false),
});

export const notifyAgentConfigSchema = z.object({
  toAgentId: z.string().optional(),
  fromAgentId: z.string().optional(),
  channel: messageChannelSchema.optional(),
  channelTargetId: z.string().nullable().optional(),
  department: z.string().optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
  priority: messagePrioritySchema.optional(),
});

export const triggerHeartbeatConfigSchema = z.object({
  agentId: z.string().optional(),
});

export const createApprovalConfigSchema = z.object({
  approvalType: approvalTypeEnum.optional(),
  summary: z.string().optional(),
  impact: z.string().optional(),
});

export const updateTaskStatusConfigSchema = z.object({
  status: z.string().optional(),
});

export const escalateToManagerConfigSchema = z.object({
  body: z.string().optional(),
});

export const crossDepartmentNotifyConfigSchema = z.object({
  department: z.string().optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
});

export const scheduleMeetingConfigSchema = z.object({
  meetingType: z.string().optional(),
  title: z.string().optional(),
  participantAgentIds: z.string().optional(),
  durationMinutes: z.number().int().positive().optional(),
  // Absolute ISO-8601 scheduling is preferred; otherwise callers can specify
  // an offset in minutes from now (replaces the previous hard-coded 60min).
  scheduledAt: z.string().optional(),
  scheduleOffsetMinutes: z.number().int().positive().optional(),
});

export const createDocumentConfigSchema = z.object({
  documentType: z.string().optional(),
  title: z.string().optional(),
  content: z.string().optional(),
});

export const autoApproveConfigSchema = z.object({}).passthrough();

export const reassignTaskConfigSchema = z.object({}).passthrough();

export const runTaskConfigSchema = z.object({
  taskId: z.string().optional(),
});

export const ACTION_SCHEMAS = {
  assign_task: assignTaskConfigSchema,
  create_task: createTaskConfigSchema,
  notify_agent: notifyAgentConfigSchema,
  send_message: notifyAgentConfigSchema,
  trigger_heartbeat: triggerHeartbeatConfigSchema,
  create_approval: createApprovalConfigSchema,
  update_task_status: updateTaskStatusConfigSchema,
  escalate_to_manager: escalateToManagerConfigSchema,
  cross_department_notify: crossDepartmentNotifyConfigSchema,
  schedule_meeting: scheduleMeetingConfigSchema,
  create_document: createDocumentConfigSchema,
  auto_approve: autoApproveConfigSchema,
  reassign_task: reassignTaskConfigSchema,
  run_task: runTaskConfigSchema,
} as const satisfies Record<AutomationAction, z.ZodTypeAny>;

export const AUTOMATION_ACTIONS = Object.freeze(Object.keys(ACTION_SCHEMAS)) as readonly AutomationAction[];
export const WORKFLOW_ACTIONS: ReadonlySet<AutomationAction> = new Set(AUTOMATION_ACTIONS);

export function isAutomationAction(action: string): action is AutomationAction {
  return WORKFLOW_ACTIONS.has(action as AutomationAction);
}

export type AutomationActionConfigMap = {
  [K in keyof typeof ACTION_SCHEMAS]: z.infer<typeof ACTION_SCHEMAS[K]>;
};

/**
 * Parse action config JSON against its per-action schema.
 * Returns the validated config or throws with the action name so the caller
 * can log/skip the rule instead of silently advancing with defaults.
 */
export function parseActionConfig<K extends keyof AutomationActionConfigMap>(
  action: K,
  json: string,
): AutomationActionConfigMap[K] {
  const raw = JSON.parse(json) as unknown;
  const schema = ACTION_SCHEMAS[action] as z.ZodSchema<AutomationActionConfigMap[K]>;
  return schema.parse(raw);
}
