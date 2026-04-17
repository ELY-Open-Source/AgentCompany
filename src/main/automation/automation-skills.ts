import type { AppDatabase } from "../database";
import { roleMatchesLeadershipKeywords } from "../agent-role-helpers";
import type { DepartmentId } from "@shared/types/enums";

const DEPARTMENT_SKILL_KEYWORDS: Record<DepartmentId, string[]> = {
  engineering: ["code", "engineer", "develop", "program", "software", "api", "backend", "frontend", "full-stack", "fullstack", "devops", "infrastructure", "system", "architect", "debug", "test", "ci", "cd", "deploy", "docker", "kubernetes", "database", "sql", "git", "typescript", "javascript", "python", "rust", "go", "java", "react", "node", "css", "html", "web"],
  product: ["product", "feature", "requirement", "roadmap", "user story", "ux", "ui", "design", "prototype", "wireframe", "specification", "prd"],
  marketing: ["market", "content", "seo", "social media", "brand", "campaign", "analytics", "growth", "copywrite", "blog", "newsletter", "email"],
  sales: ["sales", "crm", "lead", "pipeline", "deal", "revenue", "prospect", "outbound", "cold"],
  hr: ["hr", "human resource", "hiring", "recruit", "onboard", "performance", "culture", "talent", "people"],
  finance: ["finance", "budget", "accounting", "cost", "revenue", "profit", "spend", "invoice", "tax", "payroll"],
  design: ["design", "ui", "ux", "visual", "figma", "sketch", "prototype", "illustration", "typography", "layout", "color", "icon"],
  research: ["research", "analysis", "data", "study", "survey", "experiment", "insight", "benchmark", "report"],
  operations: ["operations", "process", "workflow", "efficiency", "supply chain", "logistics", "coordination"],
  customer_support: ["support", "customer", "ticket", "helpdesk", "troubleshoot", "faq", "documentation"],
  legal: ["legal", "compliance", "contract", "regulation", "policy", "privacy", "ip", "intellectual property"],
  executive: ["strategy", "leadership", "management", "executive", "ceo", "cto", "coo", "cfo", "cmo", "vp"],
};

function scoreSkillAgentMatch(
  skill: { name: string; description: string | null; markdown: string },
  agent: { role: string; department: string | null; title: string | null; capabilities: string },
): number {
  const agentText = [
    agent.role,
    agent.department ?? "",
    agent.title ?? "",
    agent.capabilities,
  ].join(" ").toLowerCase();

  const skillText = [
    skill.name,
    skill.description ?? "",
    skill.markdown.slice(0, 500),
  ].join(" ").toLowerCase();

  let score = 0;

  const dept = (agent.department ?? "") as DepartmentId;
  const deptKeywords = DEPARTMENT_SKILL_KEYWORDS[dept] ?? [];
  for (const keyword of deptKeywords) {
    if (skillText.includes(keyword)) {
      score += 2;
    }
  }

  const agentWords = agentText
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  for (const word of agentWords) {
    if (skillText.includes(word)) {
      score += 1;
    }
  }

  // Executives need awareness of all domains. Use the shared leadership
  // keyword list with word-boundary matching so "lead" does not match
  // "cleaner" / "leaderboard" in agent role strings.
  if (roleMatchesLeadershipKeywords(agent.role, agent.title)) {
    score += 1;
  }

  return score;
}

export function autoAssignSkillsToAgent(
  db: AppDatabase,
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void },
  companyId: string,
  agentId: string,
): number {
  const agent = db.getAgent(agentId);
  if (!agent || agent.companyId !== companyId) return 0;

  const allSkills = db.listCompanySkills(companyId);
  if (allSkills.length === 0) return 0;

  const existingAssignments = new Set(db.listAgentSkillAssignments(agentId));

  // Always assign basic-for-all builtin skills regardless of score
  let assigned = 0;
  for (const skill of allSkills) {
    if (existingAssignments.has(skill.id)) continue;
    try {
      const meta = skill.metadata ? (typeof skill.metadata === "string" ? JSON.parse(skill.metadata) : skill.metadata) : {};
      if (meta.builtinCategory === "basic-for-all") {
        db.assignSkillToAgent(agentId, skill.id);
        existingAssignments.add(skill.id);
        assigned++;
        logger.info(`[skill-autoassign] Assigned basic skill "${skill.name}" to ${agent.name}`);
      }
    } catch { /* skip malformed metadata */ }
  }

  const scored = allSkills
    .filter((skill) => !existingAssignments.has(skill.id))
    .map((skill) => ({
      skill,
      score: scoreSkillAgentMatch(skill, agent),
    }))
    .sort((a, b) => b.score - a.score);

  const MIN_SCORE = 3;
  for (const { skill, score } of scored) {
    if (score < MIN_SCORE) continue;
    try {
      db.assignSkillToAgent(agentId, skill.id);
      assigned++;
      logger.info(
        `[skill-autoassign] Assigned "${skill.name}" to ${agent.name} (${agent.role}) — score ${score}`,
      );
    } catch (err) {
      logger.warn(
        `[skill-autoassign] Failed to assign "${skill.name}" to ${agent.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (assigned === 0) {
    logger.info(
      `[skill-autoassign] No matching skills for ${agent.name} (${agent.role}); agent will run without skills until manually assigned`,
    );
  }

  return assigned;
}
