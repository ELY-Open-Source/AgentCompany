import { z } from "zod";
import { optionalId } from "./helpers";

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
