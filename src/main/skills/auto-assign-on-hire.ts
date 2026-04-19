import type { AppDatabase } from "../database";
import type { DepartmentId } from "@shared/types";

/**
 * Server-side default skill assignment at hire approval time.
 *
 * Before this module existed, the CEO's operating prompt was explicitly
 * told to inspect every direct report every wake, fetch the skill
 * catalogue, and POST /agents/{id}/skills for any unassigned role-
 * relevant entry. That is business logic routed through an LLM — wasted
 * tokens and an unreliable guarantee. The hire approval is the
 * deterministic moment to give a fresh agent a sensible default kit;
 * the CEO is still free to add or remove skills later.
 *
 * The mapping is department → built-in skill categories. Each seeded
 * company skill carries its category in `metadata.builtinCategory`
 * (see `skills/runtime.ts#seedBuiltinSkills`); we match against that
 * tag so a company that imported extra skills under the same category
 * inherits them too, and deletes remove the assignment pool cleanly.
 */

const CATEGORIES_BY_DEPARTMENT: Record<DepartmentId, readonly string[]> = {
  executive: ["basic-for-all", "document-process"],
  engineering: ["software-engineer", "basic-for-all"],
  product: ["frontend-design", "basic-for-all", "document-process"],
  design: ["frontend-design", "basic-for-all"],
  marketing: ["marketing", "basic-for-all", "document-process"],
  sales: ["marketing", "basic-for-all", "document-process"],
  hr: ["basic-for-all", "document-process"],
  finance: ["basic-for-all", "document-process"],
  legal: ["basic-for-all", "document-process"],
  operations: ["software-engineer", "basic-for-all", "document-process"],
  customer_support: ["basic-for-all", "document-process"],
  research: ["basic-for-all", "document-process"],
};

function readBuiltinCategory(metadata: unknown): string | null {
  if (!metadata) return null;
  if (typeof metadata === "string") {
    try {
      const parsed = JSON.parse(metadata) as Record<string, unknown>;
      const value = parsed?.builtinCategory;
      return typeof value === "string" ? value : null;
    } catch {
      return null;
    }
  }
  if (typeof metadata === "object") {
    const value = (metadata as Record<string, unknown>).builtinCategory;
    return typeof value === "string" ? value : null;
  }
  return null;
}

export interface AutoAssignSkillsInput {
  agentId: string;
  companyId: string;
  department: DepartmentId | string | null | undefined;
}

export interface AutoAssignSkillsResult {
  assignedSkillIds: string[];
}

export function autoAssignSkillsForHire(
  db: AppDatabase,
  input: AutoAssignSkillsInput,
): AutoAssignSkillsResult {
  const department = (input.department ?? "") as DepartmentId;
  const categories = CATEGORIES_BY_DEPARTMENT[department];
  if (!categories || categories.length === 0) {
    return { assignedSkillIds: [] };
  }

  const alreadyAssigned = new Set(db.listAgentSkillAssignments(input.agentId));
  const wanted = new Set(categories);
  const catalogue = db.listCompanySkills(input.companyId);

  const assigned: string[] = [];
  for (const skill of catalogue) {
    if (alreadyAssigned.has(skill.id)) continue;
    const category = readBuiltinCategory(skill.metadata);
    if (!category || !wanted.has(category)) continue;
    db.assignSkillToAgent(input.agentId, skill.id);
    assigned.push(skill.id);
  }

  return { assignedSkillIds: assigned };
}
