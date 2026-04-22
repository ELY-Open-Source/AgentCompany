import { z } from "zod";
import { optionalId } from "./helpers";

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
  requiresFilesystem: z.boolean().default(false),
  priority: z.enum(["critical", "high", "medium", "low"]).default("medium"),
  status: z.enum(["backlog", "todo", "in_progress", "in_review", "done", "blocked", "cancelled"]).default("todo"),
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

export const autoAssignSchema = z.object({
  taskId: z.string().uuid(),
  companyId: z.string().uuid(),
});
