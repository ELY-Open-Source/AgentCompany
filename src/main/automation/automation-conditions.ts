import type { AppDatabase } from "../database";
import type { AutomationEventContext } from "./types";

export function matchesEventConfig(
  db: AppDatabase,
  configJson: string,
  sourceDepartment: string | null,
  ctx: AutomationEventContext,
): boolean {
  if (sourceDepartment && ctx.department && sourceDepartment !== ctx.department) {
    return false;
  }
  // Surface malformed condition JSON to the caller (automation service) so the
  // operator sees it in logs instead of silently filtering out the rule.
  const conditions = JSON.parse(configJson) as Record<string, unknown>;
  if (Object.keys(conditions).length === 0) return true;
  if (conditions.status && ctx.newStatus && conditions.status !== ctx.newStatus) return false;
  if (conditions.previousStatus && ctx.previousStatus && conditions.previousStatus !== ctx.previousStatus) return false;
  if (conditions.priority) {
    try {
      const task = ctx.taskId ? db.getTask(ctx.taskId) : null;
      if (task && task.priority !== conditions.priority) return false;
      // If task was deleted, skip this condition instead of rejecting the rule.
    } catch {
      // Entity missing — treat as condition not applicable, continue matching.
    }
  }
  if (typeof conditions.budgetThresholdPct === "number" && ctx.agentId) {
    try {
      const agent = db.getAgent(ctx.agentId);
      if (agent.budgetMonthlyUsd > 0) {
        const utilization = agent.spentMonthlyUsd / agent.budgetMonthlyUsd;
        if (utilization < (conditions.budgetThresholdPct as number) / 100) return false;
      }
      // If budget is 0 (unlimited), skip budget condition instead of rejecting.
    } catch {
      // Agent missing — treat as condition not applicable, continue matching.
    }
  }
  if (conditions.taskId && ctx.taskId && conditions.taskId !== ctx.taskId) return false;
  if (conditions.projectId && ctx.projectId && conditions.projectId !== ctx.projectId) return false;
  if (conditions.agentId && ctx.agentId && conditions.agentId !== ctx.agentId) return false;
  return true;
}

export function matchesConditions(
  db: AppDatabase,
  rule: { conditionsJson: string; sourceDepartment: string | null },
  ctx: AutomationEventContext,
): boolean {
  return matchesEventConfig(db, rule.conditionsJson, rule.sourceDepartment, ctx);
}
