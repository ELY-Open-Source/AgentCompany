import { z } from "zod";

export const threadGetterSchema = z.object({
  companyId: z.string().uuid(),
  threadId: z.string().uuid(),
});

export const listThreadEventsSchema = z.object({
  companyId: z.string().uuid(),
  threadId: z.string().uuid(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

export const listThreadWaitStatesSchema = z.object({
  companyId: z.string().uuid(),
  resolvedOnly: z.boolean().default(false),
});
