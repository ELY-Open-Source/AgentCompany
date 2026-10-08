import type { DatabaseSync } from "node:sqlite";
import { RISK_LEVEL, TASK_PRIORITY, TASK_STATUS } from "../../shared/domain";
import { ensureAgentHeartbeat, resolveGoalKickoff } from "./goal-kickoff";
import { AuditService } from "./audit-service";
import type { OrganizationService } from "./organization-service";

interface ReviewableGoalRow {
  id: string;
  org_id: string;
  title: string;
  description: string;
  owner_agent_id: string | null;
}

/** When an active goal's board drains after real progress, hands its owner a review: close the goal or plan the next wave. */
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
    const taskId = createReviewTask(db, organization, goal);
    if (taskId) created.push(taskId);
  }
  return created;
}

/** Closes a stalled goal's stuck review and starts a fresh one; returns the new review task id. */
export function resumeGoal(db: DatabaseSync, organization: OrganizationService, orgId: string, goalId: string): string {
  const goal = db.prepare("select id, org_id, title, description, owner_agent_id, stalled_reason from goals where id = ? and org_id = ? and status = 'active'")
    .get(goalId, orgId) as (ReviewableGoalRow & { stalled_reason: string | null }) | undefined;
  if (!goal) throw new Error("Active goal was not found.");
  if (!goal.stalled_reason) throw new Error(`Goal "${goal.title}" is not stalled.`);
  db.prepare("update tasks set status = 'done', updated_at = ? where goal_id = ? and origin = 'goal_review' and status <> 'done'")
    .run(new Date().toISOString(), goalId);
  const taskId = createReviewTask(db, organization, goal);
  if (!taskId) throw new Error(`Goal "${goal.title}" has no active agent to review it.`);
  new AuditService(db).record({ orgId, entityType: "goal", entityId: goalId, actorType: "employee", actorId: null, action: "resumed", payload: { reviewTaskId: taskId } });
  return taskId;
}

function createReviewTask(db: DatabaseSync, organization: OrganizationService, goal: ReviewableGoalRow): string | null {
  const plan = resolveGoalKickoff(db, {
    orgId: goal.org_id,
    goalTitle: goal.title,
    goalDescription: goal.description,
    ownerAgentId: goal.owner_agent_id,
  });
  if (!plan) return null;
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
  db.prepare("update goals set stalled_reason = null where id = ?").run(goal.id);
  console.info(`[goal-review] created a review checkpoint for goal "${goal.title}".`);
  return taskId;
}

/** Gives an active goal a visible stalled_reason when its review loop can no longer move on its own; returns how many stalled now. */
export function markStalledGoals(db: DatabaseSync): number {
  const stalls = db.prepare(`
    select g.id, g.org_id, g.title,
      case when exists (
        select 1 from tasks r where r.goal_id = g.id and r.origin = 'goal_review' and r.status <> 'done' and r.stalled_reason is not null
      ) then 'budget' else 'silent' end as kind
    from goals g
    where g.status = 'active' and g.stalled_reason is null
      and (
        exists (select 1 from tasks r where r.goal_id = g.id and r.origin = 'goal_review' and r.status <> 'done' and r.stalled_reason is not null)
        or (
          not exists (select 1 from tasks t where t.goal_id = g.id and t.status in ('backlog', 'in_progress', 'review'))
          and exists (select 1 from tasks r where r.goal_id = g.id and r.origin = 'goal_review')
          and not exists (
            select 1 from tasks t
            where t.goal_id = g.id and t.status = 'done' and t.origin is null
              and t.updated_at > (select max(r.created_at) from tasks r where r.goal_id = g.id and r.origin = 'goal_review')
          )
        )
      )
  `).all() as Array<{ id: string; org_id: string; title: string; kind: "budget" | "silent" }>;
  const audit = new AuditService(db);
  for (const goal of stalls) {
    const reason = goal.kind === "budget"
      ? "Stalled: the goal review spent its run budget without a decision. Resume it to run a fresh review."
      : "Stalled: the last goal review neither closed the goal nor planned new work. Resume it to run a fresh review.";
    db.prepare("update goals set stalled_reason = ? where id = ?").run(reason, goal.id);
    console.warn(`[goal-review] goal "${goal.title}" ${reason}`);
    audit.record({ orgId: goal.org_id, entityType: "goal", entityId: goal.id, actorType: "system", actorId: null, action: "stalled", payload: { reason } });
  }
  return stalls.length;
}

function goalReviewDescription(goalTitle: string): string {
  return [
    `Every task under the goal "${goalTitle.trim()}" is finished, but the goal itself is still open. Decide what happens next — this is a checkpoint, not a formality.`,
    "First gather evidence: list_files and read_file the workspace, and read what the team reported. Plans, specs, and status documents are not the product. If the goal promises working software, the proof is code in the workspace that builds and passes its tests (run_command).",
    "Then take exactly one of these actions before closing this task:",
    "1. The goal is genuinely achieved -> call complete_goal with the files and documents that hold the result. An independent auditor inspects the workspace before the goal actually closes, so claims without substance will bounce.",
    "2. It is not achieved -> create the next wave of tasks (create_task, assigned by name). Implementation work must set requires_filesystem: true so the assignee can change code and run commands. Documents alone must not close the next wave either.",
  ].join("\n\n");
}
