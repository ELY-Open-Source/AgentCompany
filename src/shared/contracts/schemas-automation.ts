import { z } from "zod";
import { DEPARTMENT_IDS } from "./helpers";

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
