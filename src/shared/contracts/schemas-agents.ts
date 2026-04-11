import { z } from "zod";
import { DEPARTMENT_IDS, optionalId } from "./helpers";
import { connectorInputSchema } from "./schemas-company";

const agentNameSchema = z.string().trim().min(2).max(80);
const agentRoleSchema = z.string().trim().min(2).max(80);
const agentTitleSchema = z.string().trim().max(80).default("");

export const agentInputSchema = z.object({
  id: optionalId,
  companyId: z.string().uuid(),
  name: agentNameSchema,
  role: agentRoleSchema,
  title: agentTitleSchema,
  department: DEPARTMENT_IDS.nullable().optional(),
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
  name: agentNameSchema,
  role: agentRoleSchema,
  title: agentTitleSchema,
  department: DEPARTMENT_IDS.nullable().optional(),
  reportsTo: optionalId,
  connectorId: connectorInputSchema.shape.id,
  workspaceId: optionalId,
  model: z.string().nullable().optional(),
  metadataJson: z.string().default("{}").optional(),
  capabilities: z.string().default(""),
  budgetMonthlyUsd: z.number().min(0).default(0),
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
