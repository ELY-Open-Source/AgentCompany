import type { AppDatabase } from "./database";
import type { TaskRecord } from "@shared/types";

function safeGetAgent(db: AppDatabase, agentId: string) {
  try {
    return db.getAgent(agentId);
  } catch {
    return null;
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

function hasManagementAuthority(agent: { role: string; title: string; department: string | null }) {
  if (agent.department === "hr") {
    return true;
  }

  const text = `${agent.role} ${agent.title}`.toLowerCase();
  return MANAGEMENT_KEYWORDS.some((keyword) => text.includes(keyword));
}

function hasOrganizationPermission(db: AppDatabase, agentId: string) {
  return db.hasAgentPermission(agentId, "organization_manage");
}

function managesAgent(db: AppDatabase, managerId: string, targetAgentId: string): boolean {
  if (managerId === targetAgentId) {
    return true;
  }
  return db.getChainOfCommand(targetAgentId).some((agent) => agent.id === managerId);
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
  if (db.getDirectReports(agentId, companyId).length > 0) {
    return true;
  }
  return hasManagementAuthority(agent);
}

export function canAssignTask(db: AppDatabase, companyId: string, actorAgentId: string, targetAgentId: string | null): boolean {
  if (!targetAgentId || targetAgentId === actorAgentId) {
    return true;
  }
  if (!db.belongsToCompany("agents", targetAgentId, companyId)) {
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
