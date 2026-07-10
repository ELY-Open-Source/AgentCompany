import { AuditService } from "./audit-service";
import type { AgentToolContext, AgentToolDeps } from "./agent-tools";
import type { ToolDefinition } from "./provider-tool-turn";

export const GOAL_TOOLS: ToolDefinition[] = [
  {
    name: "complete_goal",
    description: "Mark the goal your current task belongs to as achieved. CEO or the goal's owner only. Call it only when the evidence shows the goal is genuinely delivered — for software, that means code in the workspace that builds and passes its tests, not documents about it.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
];

export function completeGoalTool(deps: AgentToolDeps, ctx: AgentToolContext): string {
  if (!ctx.taskGoalId) return "ERROR: this task is not attached to a goal, so there is nothing to complete.";
  const goal = deps.db.prepare("select id, title, status, owner_agent_id from goals where id = ? and org_id = ?")
    .get(ctx.taskGoalId, ctx.orgId) as { id: string; title: string; status: string; owner_agent_id: string | null } | undefined;
  if (!goal) throw new Error("Goal was not found.");
  const acting = deps.db.prepare("select role_level from agents where id = ? and org_id = ?")
    .get(ctx.agent.id, ctx.orgId) as { role_level: string } | undefined;
  if (acting?.role_level !== "c_suite" && ctx.agent.id !== goal.owner_agent_id) {
    return "ERROR: Only the CEO or the goal's owner can complete a goal. Report your evidence to them instead.";
  }
  if (goal.status !== "active") return `Goal "${goal.title}" is already ${goal.status}.`;
  deps.db.prepare("update goals set status = 'achieved', updated_at = ? where id = ? and org_id = ?")
    .run(new Date().toISOString(), goal.id, ctx.orgId);
  new AuditService(deps.db).record({
    orgId: ctx.orgId,
    entityType: "goal",
    entityId: goal.id,
    actorType: "agent",
    actorId: ctx.agent.id,
    action: "status_changed",
    payload: { status: "achieved" },
  });
  return `Goal "${goal.title}" is marked achieved. Tell the team.`;
}
