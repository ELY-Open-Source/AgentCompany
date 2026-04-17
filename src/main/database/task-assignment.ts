import type { DatabaseSync } from "node:sqlite";
import type { ReadAll } from "./helpers";

interface AssignmentTask {
  id: string;
  title: string;
  description: string;
  projectId: string | null;
}

interface AssignmentCandidate {
  id: string;
  name: string;
  department: string | null;
  capabilities: string;
  taskCount: number;
  budgetMonthlyUsd: number;
  spentMonthlyUsd: number;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter((word) => word.length > 3);
}

function getProjectDepartment(
  db: DatabaseSync,
  companyId: string,
  projectId: string | null,
): string | null {
  if (!projectId) return null;
  const project = db
    .prepare("select lead_agent_id from projects where id = ? and company_id = ?")
    .get(projectId, companyId) as { lead_agent_id: string | null } | undefined;
  if (!project?.lead_agent_id) return null;
  const lead = db
    .prepare("select department from agents where id = ? and company_id = ?")
    .get(project.lead_agent_id, companyId) as { department: string | null } | undefined;
  return lead?.department ?? null;
}

function loadSkillWordsForAgents(
  readAll: ReadAll,
  companyId: string,
  agentIds: string[],
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  if (agentIds.length === 0) return result;
  const placeholders = agentIds.map(() => "?").join(",");
  const rows = readAll<{ agentId: string; name: string; description: string | null; slug: string }>(
    `select asa.agent_id as agentId, cs.name, cs.description, cs.slug
       from company_skills cs
       join agent_skill_assignments asa on asa.skill_id = cs.id
      where cs.company_id = ? and asa.agent_id in (${placeholders})`,
    companyId,
    ...agentIds,
  );
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const blob = `${row.name} ${row.description ?? ""} ${row.slug}`;
    const existing = grouped.get(row.agentId);
    if (existing) existing.push(blob);
    else grouped.set(row.agentId, [blob]);
  }
  for (const agentId of agentIds) {
    result.set(agentId, tokenize((grouped.get(agentId) ?? []).join(" ")));
  }
  return result;
}

function loadAgentsWithReports(
  readAll: ReadAll,
  companyId: string,
  agentIds: string[],
): Set<string> {
  const result = new Set<string>();
  if (agentIds.length === 0) return result;
  const placeholders = agentIds.map(() => "?").join(",");
  const rows = readAll<{ reportsTo: string }>(
    `select distinct reports_to as reportsTo from agents where company_id = ? and reports_to in (${placeholders})`,
    companyId,
    ...agentIds,
  );
  for (const row of rows) result.add(row.reportsTo);
  return result;
}

export function chooseBestTaskAssignee(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  companyId: string,
  task: AssignmentTask,
  candidates: AssignmentCandidate[],
): string | null {
  const eligibleCandidates = candidates.filter((candidate) => {
    if (candidate.budgetMonthlyUsd > 0 && candidate.spentMonthlyUsd >= candidate.budgetMonthlyUsd) {
      return false;
    }
    return true;
  });

  if (eligibleCandidates.length === 0) {
    return null;
  }

  const taskWords = tokenize(`${task.title} ${task.description}`);
  const projectDept = getProjectDepartment(getDb(), companyId, task.projectId);
  const eligibleIds = eligibleCandidates.map((candidate) => candidate.id);
  const skillWordsByAgent = loadSkillWordsForAgents(readAll, companyId, eligibleIds);
  const agentsWithReports = loadAgentsWithReports(readAll, companyId, eligibleIds);

  let bestAgentId: string | null = null;
  let bestScore = -Infinity;

  for (const candidate of eligibleCandidates) {
    const capabilityWords = tokenize(candidate.capabilities);
    const skillWords = skillWordsByAgent.get(candidate.id) ?? [];
    const capabilityOverlap = taskWords.filter((word) => capabilityWords.includes(word)).length;
    const skillOverlap = taskWords.filter((word) => skillWords.includes(word)).length;
    let score = capabilityOverlap * 10 + skillOverlap * 12 - candidate.taskCount * 5;
    if (projectDept && candidate.department === projectDept) {
      score += 15;
    }
    if (!agentsWithReports.has(candidate.id)) {
      score += 5;
    }
    if (
      score > bestScore ||
      (score === bestScore &&
        candidate.taskCount <
          (eligibleCandidates.find((entry) => entry.id === bestAgentId)?.taskCount ?? Number.POSITIVE_INFINITY))
    ) {
      bestScore = score;
      bestAgentId = candidate.id;
    }
  }

  return bestAgentId ?? eligibleCandidates[0]?.id ?? null;
}
