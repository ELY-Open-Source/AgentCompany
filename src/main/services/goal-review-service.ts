import type { DatabaseSync } from "node:sqlite";
import { RISK_LEVEL, TASK_PRIORITY, TASK_STATUS } from "../../shared/domain";
import { ensureAgentHeartbeat, resolveGoalKickoff } from "./goal-kickoff";
import type { OrganizationService } from "./organization-service";

interface ReviewableGoalRow {
  id: string;
  org_id: string;
  title: string;
  description: string;
  owner_agent_id: string | null;
}

/**
 * Closes the loop the task pipeline leaves open: tasks end at `done`, but a
 * company is finished when its GOAL is achieved. Whenever an active goal has
 * no open tasks left and real work landed since the last checkpoint, the goal
 * owner (usually the CEO) gets one review task: verify the goal against the
 * actual state of the workspace, then either mark it achieved (complete_goal)
 * or plan the next wave of tasks. Without this, the company drains its board,
 * declares nothing, and idles forever under a still-active goal.
 *
 * Termination is structural: chatter (`chat_wake`) and reviews themselves
 * never count as progress, so a review that ends with no new work and no
 * completed goal does NOT respawn — the loop only continues while real tasks
 * keep completing or the goal is closed.
 */
export function spawnGoalReviews(db: DatabaseSync, organization: OrganizationService): string[] {
  const goals = db.prepare(`
    select g.id, g.org_id, g.title, g.description, g.owner_agent_id
    from goals g
    where g.status = 'active'
      and not exists (
        select 1 from tasks t
        where t.goal_id = g.id and t.status in ('backlog', 'in_progress', 'review')
      )
      and exists (
        select 1 from tasks t
        where t.goal_id = g.id and t.status = 'done' and t.origin is null
      )
      and (
        not exists (
          select 1 from tasks r where r.goal_id = g.id and r.origin = 'goal_review'
        )
        or exists (
          select 1 from tasks t
          where t.goal_id = g.id and t.status = 'done' and t.origin is null
            and t.updated_at > (
              select max(r.created_at) from tasks r
              where r.goal_id = g.id and r.origin = 'goal_review'
            )
        )
      )
  `).all() as unknown as ReviewableGoalRow[];

  const created: string[] = [];
  for (const goal of goals) {
    const plan = resolveGoalKickoff(db, {
      orgId: goal.org_id,
      goalTitle: goal.title,
      goalDescription: goal.description,
      ownerAgentId: goal.owner_agent_id,
    });
    if (!plan) continue;
    ensureAgentHeartbeat(db, goal.org_id, plan.assigneeAgentId);
    const taskId = organization.createTask({
      orgId: goal.org_id,
      title: `Goal review: ${goal.title.trim()}`,
      description: goalReviewDescription(goal.title),
      status: TASK_STATUS.BACKLOG,
      assigneeAgentId: plan.assigneeAgentId,
      risk: RISK_LEVEL.MEDIUM,
      projectId: null,
      goalId: goal.id,
      workspaceId: plan.workspaceId,
      priority: TASK_PRIORITY.HIGH,
      requiresFilesystem: plan.workspaceId !== null,
      origin: "goal_review",
    });
    created.push(taskId);
    console.info(`[goal-review] all tasks for goal "${goal.title}" are finished; created a review checkpoint for the goal owner.`);
  }
  return created;
}

function goalReviewDescription(goalTitle: string): string {
  return [
    `Every task under the goal "${goalTitle.trim()}" is finished, but the goal itself is still open. Decide what happens next — this is a checkpoint, not a formality.`,
    "First gather evidence: list_files and read_file the workspace, and read what the team reported. Plans, specs, and status documents are not the product. If the goal promises working software, the proof is code in the workspace that builds and passes its tests (run_command).",
    "Then take exactly one of these actions before closing this task:",
    "1. The goal is genuinely achieved -> call complete_goal.",
    "2. It is not achieved -> create the next wave of tasks (create_task, assigned by name). Implementation work must set requires_filesystem: true so the assignee can change code and run commands. Documents alone must not close the next wave either.",
  ].join("\n\n");
}
