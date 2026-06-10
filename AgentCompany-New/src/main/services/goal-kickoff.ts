import type { DatabaseSync } from "node:sqlite";
import { RISK_LEVEL, TASK_STATUS } from "../../shared/domain";
import { createId } from "../../shared/ids";

export interface CreatedGoalKickoffInput {
  orgId: string;
  goalId: string;
  title: string;
  description: string;
  ownerAgentId: string | null;
}

/**
 * Routes a newly created goal to an accountable agent — the chosen owner,
 * or the top-level agent (the CEO) — as a kickoff task bound to the org's
 * primary workspace. Returns null when the org has no agent yet; the goal
 * then waits until one exists.
 */
export function kickoffCreatedGoal(db: DatabaseSync, input: CreatedGoalKickoffInput): string | null {
  const assigneeAgentId = input.ownerAgentId ?? topLevelActiveAgentId(db, input.orgId);
  if (!assigneeAgentId) return null;
  const organization = db.prepare("select name from organizations where id = ?")
    .get(input.orgId) as { name: string };
  return createGoalKickoffTask(db, {
    orgId: input.orgId,
    goalId: input.goalId,
    goalTitle: input.title,
    goalDescription: input.description,
    companyName: organization.name,
    assigneeAgentId,
    projectId: null,
    workspaceId: primaryWorkspaceId(db, input.orgId),
  });
}

function topLevelActiveAgentId(db: DatabaseSync, orgId: string): string | null {
  const row = db.prepare(`
    select id from agents
    where org_id = ? and manager_agent_id is null and lifecycle = 'active'
    order by created_at asc
    limit 1
  `).get(orgId) as { id: string } | undefined;
  return row?.id ?? null;
}

function primaryWorkspaceId(db: DatabaseSync, orgId: string): string | null {
  const row = db.prepare("select id from workspaces where org_id = ? and is_primary = 1 order by created_at asc limit 1")
    .get(orgId) as { id: string } | undefined;
  return row?.id ?? null;
}

export interface GoalKickoffTaskInput {
  orgId: string;
  goalId: string;
  goalTitle: string;
  goalDescription: string;
  companyName: string;
  assigneeAgentId: string;
  projectId: string | null;
  workspaceId: string | null;
}

/**
 * Turns an active goal into its assignee's first actionable work item: a
 * backlog kickoff task the autonomous heartbeat starts as soon as the agent
 * has a runnable provider. Onboarding bootstrap and in-app goal creation
 * share this contract, so a goal can never exist without an agent obligated
 * to operationalize it.
 */
export function createGoalKickoffTask(db: DatabaseSync, input: GoalKickoffTaskInput): string {
  ensureAgentHeartbeat(db, input.orgId, input.assigneeAgentId);
  const taskId = createId("tsk");
  const now = new Date().toISOString();
  db.prepare(`
    insert into tasks(
      id, org_id, title, description, status, assignee_agent_id, risk,
      project_id, goal_id, workspace_id, priority, requires_filesystem, created_at, updated_at
    )
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    taskId,
    input.orgId,
    `Operationalize goal: ${input.goalTitle.trim()}`,
    kickoffDescription(input),
    TASK_STATUS.BACKLOG,
    input.assigneeAgentId,
    RISK_LEVEL.MEDIUM,
    input.projectId,
    input.goalId,
    input.workspaceId,
    "high",
    input.workspaceId ? 1 : 0,
    now,
    now,
  );
  return taskId;
}

function kickoffDescription(input: GoalKickoffTaskInput): string {
  return [
    `Company: ${input.companyName.trim()}`,
    `Goal: ${input.goalTitle.trim()}`,
    input.goalDescription.trim(),
    "Read the bound workspace, create the first operating plan, delegate work, and route decisions through approvals and messages.",
  ].filter((line) => line.length > 0).join("\n\n");
}

/**
 * Waking an agent re-enables its heartbeat (same contract as the previous
 * runtime), so a kickoff assigned to an agent hired without a provider still
 * starts autonomously once a provider is configured.
 */
function ensureAgentHeartbeat(db: DatabaseSync, orgId: string, agentId: string): void {
  db.prepare(`
    update agents
    set heartbeat_enabled = 1,
        heartbeat_interval_sec = case when heartbeat_interval_sec > 0 then heartbeat_interval_sec else 120 end
    where id = ? and org_id = ?
  `).run(agentId, orgId);
}
