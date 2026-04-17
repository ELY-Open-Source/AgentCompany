import { z } from "zod";

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

export const entityGetterSchema = z.object({
  companyId: z.string().uuid(),
  id: z.string().uuid(),
});

export const metricsQuerySchema = z.object({
  companyId: z.string().uuid(),
  agentId: z.string().uuid().optional(),
  days: z.number().int().min(1).max(90).default(30),
});
