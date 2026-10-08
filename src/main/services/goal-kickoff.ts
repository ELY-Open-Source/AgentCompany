import type { DatabaseSync } from "node:sqlite";
import { firstHiresFor, leadsPeople } from "./org-building";

export interface GoalKickoffPlan {
  assigneeAgentId: string;
  workspaceId: string | null;
  title: string;
  description: string;
}

/**
 * Plans the kickoff work for an active goal: the chosen owner when that agent
 * is still active, otherwise the top-level active agent (the CEO), bound to
 * the org's primary workspace. Returns null when the org has no eligible
 * agent — creating the first agent then kicks off every untouched goal, so a
 * goal never stays inert.
 */
export function resolveGoalKickoff(db: DatabaseSync, input: {
  orgId: string;
  goalTitle: string;
  goalDescription: string;
  ownerAgentId: string | null;
}): GoalKickoffPlan | null {
  const assigneeAgentId = activeAgentId(db, input.orgId, input.ownerAgentId) ?? topLevelActiveAgentId(db, input.orgId);
  if (!assigneeAgentId) return null;
  const organization = db.prepare("select name from organizations where id = ?")
    .get(input.orgId) as { name: string };
  const owner = db.prepare(`
    select role_level, exists(select 1 from agents r where r.manager_agent_id = a.id and r.lifecycle = 'active') as has_reports
    from agents a where a.id = ?
  `).get(assigneeAgentId) as { role_level: string; has_reports: number };
  return {
    assigneeAgentId,
    workspaceId: primaryWorkspaceId(db, input.orgId),
    title: goalKickoffTitle(input.goalTitle),
    description: goalKickoffDescription(organization.name, input.goalTitle, input.goalDescription, { roleLevel: owner.role_level, hasReports: owner.has_reports === 1 }),
  };
}

function kickoffDirection(owner: { roleLevel: string; hasReports: boolean }): string {
  const groundwork = "Read the bound workspace, create the first operating plan, and route decisions through approvals and messages.";
  if (owner.roleLevel === "c_suite") {
    return `Treat this goal as the company objective and build the organization that can deliver it: ${firstHiresFor(owner.roleLevel)}. Give each officer their department objective as a task, and let them build and run their own teams. ${groundwork}`;
  }
  if (leadsPeople(owner.roleLevel, owner.hasReports)) {
    const staffing = owner.hasReports ? "Give each report their part of it as a task" : `Build the team that can deliver it: ${firstHiresFor(owner.roleLevel)}, then give each report their part as a task`;
    return `Treat this goal as your objective. ${staffing}. ${groundwork}`;
  }
  return `Treat this goal as your objective: plan the work, do it, and tell your manager early if it needs more people. ${groundwork}`;
}

export function goalKickoffTitle(goalTitle: string): string {
  return `Operationalize goal: ${goalTitle.trim()}`;
}

export function goalKickoffDescription(
  companyName: string, goalTitle: string, goalDescription: string, owner: { roleLevel: string; hasReports: boolean },
): string {
  return [
    `Company: ${companyName.trim()}`,
    `Goal: ${goalTitle.trim()}`,
    goalDescription.trim(),
    kickoffDirection(owner),
  ].filter((line) => line.length > 0).join("\n\n");
}

/**
 * Waking an agent re-enables its heartbeat (same contract as the previous
 * runtime), so a kickoff assigned to an agent hired without a provider still
 * starts autonomously once a provider is configured. This also resumes the
 * agent's other backlog work — waking an agent wakes all of its assignments.
 */
export function ensureAgentHeartbeat(db: DatabaseSync, orgId: string, agentId: string): void {
  db.prepare(`
    update agents
    set heartbeat_enabled = 1,
        heartbeat_interval_sec = case when heartbeat_interval_sec > 0 then heartbeat_interval_sec else 120 end
    where id = ? and org_id = ?
  `).run(agentId, orgId);
}

function activeAgentId(db: DatabaseSync, orgId: string, agentId: string | null): string | null {
  if (!agentId) return null;
  const row = db.prepare("select id from agents where id = ? and org_id = ? and lifecycle = 'active'")
    .get(agentId, orgId) as { id: string } | undefined;
  return row?.id ?? null;
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
