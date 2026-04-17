import { z } from "zod";

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
