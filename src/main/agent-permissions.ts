import type { AppDatabase } from "./database";
import type { TaskRecord } from "@shared/types";

function safeGetAgent(db: AppDatabase, agentId: string | null | undefined) {
  if (!agentId) {
    return null;
  }
  try {
    return db.core.entity.getAgent(agentId);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Agent not found:")) {
      return null;
    }
    throw error;
  }
}

const MANAGEMENT_KEYWORDS = [
  "chief",
  "cto",
  "cmo",
  "coo",
  "cfo",
  "vp",
  "vice president",
  "head",
  "director",
  "manager",
  "lead",
];

/** Regex union for MANAGEMENT_KEYWORDS with `\b`-anchored matching so short
 * tokens like "vp" or "cmo" do not false-match inside "vpc" or "economical". */
const MANAGEMENT_KEYWORD_PATTERN = new RegExp(
  `\\b(?:${MANAGEMENT_KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "i",
);

export function hasManagementAuthority(agent: { role: string; title: string; department: string | null }) {
  if (agent.department === "hr") {
    return true;
  }

  const text = `${agent.role} ${agent.title}`;
  return MANAGEMENT_KEYWORD_PATTERN.test(text);
}

function hasOrganizationPermission(db: AppDatabase, agentId: string) {
  return db.core.agents.hasAgentPermission(agentId, "organization_manage");
}

function managesAgent(db: AppDatabase, managerId: string, targetAgentId: string): boolean {
  if (managerId === targetAgentId) {
    return true;
  }
  return db.core.agents.getChainOfCommand(targetAgentId).some((agent) => agent.id === managerId);
}

export function canControlAgent(db: AppDatabase, companyId: string, actorAgentId: string, targetAgentId: string): boolean {
  const actor = safeGetAgent(db, actorAgentId);
  const target = safeGetAgent(db, targetAgentId);
  if (!actor || !target) {
    return false;
  }
  if (actor.companyId !== companyId || target.companyId !== companyId) {
    return false;
  }
  if (actor.id === target.id) {
    return true;
  }
  if (canManageOrganization(db, companyId, actorAgentId)) {
    return true;
  }
  return managesAgent(db, actorAgentId, targetAgentId);
}

export function canManageOrganization(db: AppDatabase, companyId: string, agentId: string): boolean {
  const agent = safeGetAgent(db, agentId);
  if (!agent || agent.companyId !== companyId) {
    return false;
  }
  if (!agent.reportsTo) {
    return true;
  }
  if (hasOrganizationPermission(db, agentId)) {
    return true;
  }
  return agent.department === "hr";
}

export function canRequestHire(db: AppDatabase, companyId: string, agentId: string): boolean {
  const agent = safeGetAgent(db, agentId);
  if (!agent || agent.companyId !== companyId) {
    return false;
  }
  if (canManageOrganization(db, companyId, agentId)) {
    return true;
  }
  if (db.core.agents.getDirectReports(agentId, companyId).length > 0) {
    return true;
  }
  return hasManagementAuthority(agent);
}

const CEO_ROLE_PATTERN = /^(chief executive officer|ceo)$/i;
const CEO_TITLE_PATTERN = /^ceo$/i;

/**
 * True only when the agent is a top-level CEO — CEO-equivalent role/title
 * AND no internal manager (`reportsTo === null`, i.e. reports to the Board).
 *
 * Intentionally orthogonal to {@link canRequestHire}: hiring authority spans
 * managers, directors, VPs, HR, etc., but the `approve_ceo_strategy` flow is
 * the CEO's alone. Using `reportsTo === null` by itself is too loose (a VP
 * with no manager would slip through) and using a keyword list by itself is
 * too loose (a "VP" matches the management keywords). Requiring both pins
 * the predicate to a genuine CEO even when someone inserts a virtual
 * superior above an executive.
 */
export function canFileCeoStrategy(db: AppDatabase, companyId: string, agentId: string): boolean {
  const agent = safeGetAgent(db, agentId);
  if (!agent || agent.companyId !== companyId) {
    return false;
  }
  if (agent.reportsTo !== null) {
    return false;
  }
  return CEO_ROLE_PATTERN.test(agent.role.trim()) || CEO_TITLE_PATTERN.test(agent.title.trim());
}

function getDepartmentLeadCandidateId(
  db: AppDatabase,
  companyId: string,
  department: string,
  excludeAgentId: string | null,
): string | null {
  const candidates = db.queryAll<{
    id: string;
    role: string;
    title: string;
    department: string | null;
    createdAt: string;
  }>(
    `select id, role, title, department, created_at as createdAt
       from agents
      where company_id = ?
        and department = ?
        and status not in ('terminated', 'pending_approval')`,
    companyId,
    department,
  );

  const ranked = candidates
    .filter((candidate) => candidate.id !== excludeAgentId)
    .map((candidate) => ({
      id: candidate.id,
      hasReports: db.core.agents.getDirectReports(candidate.id, companyId).length > 0,
      leadershipScore: hasManagementAuthority(candidate) ? 1 : 0,
      chainDepth: db.core.agents.getChainOfCommand(candidate.id).length,
      createdAt: candidate.createdAt,
    }))
    .filter((candidate) => candidate.hasReports || candidate.leadershipScore > 0)
    .sort((left, right) => {
      if (left.hasReports !== right.hasReports) return left.hasReports ? -1 : 1;
      if (left.leadershipScore !== right.leadershipScore) return right.leadershipScore - left.leadershipScore;
      if (left.chainDepth !== right.chainDepth) return left.chainDepth - right.chainDepth;
      return left.createdAt.localeCompare(right.createdAt);
    });

  return ranked[0]?.id ?? null;
}

export function resolveHireReportsTo(
  db: AppDatabase,
  companyId: string,
  requestedByAgentId: string | null | undefined,
  explicitReportsTo: string | null | undefined,
  department: string | null | undefined,
): string | null {
  if (explicitReportsTo !== undefined) {
    return explicitReportsTo;
  }

  const requester = requestedByAgentId ? safeGetAgent(db, requestedByAgentId) : null;
  if (requester && requester.companyId !== companyId) {
    return null;
  }

  if (!department) {
    return requester?.id ?? db.core.agents.getCeoForCompany(companyId)?.id ?? null;
  }

  if (requester && (requester.department === department || !requester.reportsTo)) {
    return requester.id;
  }

  const departmentLeadId = getDepartmentLeadCandidateId(db, companyId, department, requester?.id ?? null);
  if (departmentLeadId) {
    return departmentLeadId;
  }

  if (requester) {
    return requester.id;
  }

  return db.core.agents.getCeoForCompany(companyId)?.id ?? null;
}

function normalizeComparableText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_\-()[\]{}]+/g, " ")
    .replace(/\s+/g, " ");
}

function isAllowedRoleAcronym(value: string): boolean {
  return /^[A-Z]{2,5}$/.test(value.trim());
}

export function getHireNameValidationError(input: {
  name: string;
  role: string;
  title: string;
}): string | null {
  const normalizedName = normalizeComparableText(input.name);
  if (!normalizedName) {
    return "Hire requests require a real display name.";
  }
  const normalizedRole = normalizeComparableText(input.role);
  const normalizedTitle = normalizeComparableText(input.title);
  if (normalizedName === normalizedRole && !isAllowedRoleAcronym(input.name)) {
    return "Hire name must be a real display name, not just the role.";
  }
  if (
    normalizedTitle.length > 0 &&
    normalizedName === normalizedTitle &&
    !isAllowedRoleAcronym(input.name)
  ) {
    return "Hire name must be a real display name, not just the title.";
  }
  return null;
}

export function getHireRoutingValidationError(
  db: AppDatabase,
  companyId: string,
  requestedByAgentId: string | null | undefined,
  reportsTo: string | null | undefined,
  department: string | null | undefined,
): string | null {
  const requester = requestedByAgentId ? safeGetAgent(db, requestedByAgentId) : null;
  const manager = reportsTo ? safeGetAgent(db, reportsTo) : null;
  const requestedDepartment = department ?? null;

  if (requester && requester.companyId !== companyId) {
    return "Requesting agent does not belong to the current company.";
  }
  if (!requestedDepartment) {
    return null;
  }
  if (reportsTo != null && !manager) {
    return "Selected manager not found.";
  }
  if (manager && manager.companyId !== companyId) {
    return "Selected manager does not belong to the current company.";
  }

  if (
    manager &&
    manager.reportsTo != null &&
    manager.department !== requestedDepartment
  ) {
    return "Selected manager must belong to the same department as the new hire, unless they are a top-level executive.";
  }

  return null;
}

export function canAssignTask(db: AppDatabase, companyId: string, actorAgentId: string, targetAgentId: string | null): boolean {
  if (!targetAgentId || targetAgentId === actorAgentId) {
    return true;
  }
  if (!db.core.settings.belongsToCompany("agents", targetAgentId, companyId)) {
    return false;
  }
  if (canManageOrganization(db, companyId, actorAgentId)) {
    return true;
  }
  return managesAgent(db, actorAgentId, targetAgentId);
}

export function canUpdateTask(db: AppDatabase, companyId: string, actorAgentId: string, task: TaskRecord): boolean {
  if (task.companyId !== companyId) {
    return false;
  }
  if (task.assigneeAgentId === actorAgentId) {
    return true;
  }
  if (!task.assigneeAgentId) {
    return canManageOrganization(db, companyId, actorAgentId);
  }
  if (canManageOrganization(db, companyId, actorAgentId)) {
    return true;
  }
  return managesAgent(db, actorAgentId, task.assigneeAgentId);
}

export function canManageGoal(db: AppDatabase, companyId: string, actorAgentId: string, ownerAgentId: string | null): boolean {
  if (canManageOrganization(db, companyId, actorAgentId)) {
    return true;
  }
  return Boolean(ownerAgentId && ownerAgentId === actorAgentId);
}

export function canManageProject(db: AppDatabase, companyId: string, actorAgentId: string, leadAgentId: string | null): boolean {
  if (canManageOrganization(db, companyId, actorAgentId)) {
    return true;
  }
  return Boolean(leadAgentId && leadAgentId === actorAgentId);
}
