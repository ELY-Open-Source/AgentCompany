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

function getAgentSkillWords(
  db: DatabaseSync,
  readAll: ReadAll,
  companyId: string,
  agentId: string,
): string[] {
  const skills = readAll<{ name: string; description: string | null; slug: string }>(
    `select cs.name, cs.description, cs.slug
       from company_skills cs
       join agent_skill_assignments asa on asa.skill_id = cs.id
      where asa.agent_id = ? and cs.company_id = ?`,
    agentId,
    companyId,
  );
  return tokenize(skills.map((skill) => `${skill.name} ${skill.description ?? ""} ${skill.slug}`).join(" "));
}

function scoreCandidate(
  db: DatabaseSync,
  readAll: ReadAll,
  companyId: string,
  taskWords: string[],
  projectDept: string | null,
  candidate: AssignmentCandidate,
): number {
  const capabilityWords = tokenize(candidate.capabilities);
  const skillWords = getAgentSkillWords(db, readAll, companyId, candidate.id);
  const capabilityOverlap = taskWords.filter((word) => capabilityWords.includes(word)).length;
  const skillOverlap = taskWords.filter((word) => skillWords.includes(word)).length;
  let score = capabilityOverlap * 10 + skillOverlap * 12 - candidate.taskCount * 5;

  if (projectDept && candidate.department === projectDept) {
    score += 15;
  }

  const hasReports = readAll<{ id: string }>(
    "select id from agents where reports_to = ? and company_id = ? limit 1",
    candidate.id,
    companyId,
  ).length > 0;
  if (!hasReports) {
    score += 5;
  }

  return score;
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

  let bestAgentId: string | null = null;
  let bestScore = -Infinity;

  for (const candidate of eligibleCandidates) {
    const score = scoreCandidate(getDb(), readAll, companyId, taskWords, projectDept, candidate);
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
