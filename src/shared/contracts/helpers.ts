import { z } from "zod";

export const optionalId = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().uuid().nullable().optional(),
);

/** Canonical department identifiers shared across agent and automation schemas. */
export const DEPARTMENT_IDS = z.enum([
  "executive", "engineering", "product", "marketing", "sales",
  "hr", "finance", "legal", "operations", "customer_support", "research", "design",
]);

/** Canonical message channel types shared across messaging schemas. */
export const MESSAGE_CHANNELS = z.enum([
  "direct", "department", "company", "project", "incident",
]);

/**
 * Canonical automation trigger enum shared by `automationRuleInputSchema` and
 * `workflowInputSchema`. Single source of truth: the TS `AutomationTrigger`
 * alias in `types/enums.ts` derives from this enum.
 */
export const automationTriggerEnum = z.enum([
  "task_status_changed", "task_created", "task_blocked", "task_reassigned",
  "run_completed", "run_failed", "approval_created", "approval_resolved",
  "budget_threshold", "agent_idle", "comment_posted", "document_created",
  "schedule", "hire_approved", "sprint_started", "sprint_ended",
]);

export type AutomationTrigger = z.infer<typeof automationTriggerEnum>;
