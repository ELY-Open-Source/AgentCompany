import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../../src/main/database";
import {
  canAssignTask,
  canControlAgent,
  canManageGoal,
  canManageOrganization,
  canManageProject,
  canRequestHire,
} from "../../src/main/agent-permissions";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("canManageOrganization", () => {
  it("allows executive leaders without direct reports to manage organization growth", async () => {
    const profileDir = await createTempDir("agentcompany-agent-perms-");
    const db = new AppDatabase(profileDir);
    db.init();

    const companyId = db.saveCompany({
      name: "Org Permissions Co",
      description: "Tests recursive org authority",
      status: "active",
    });
    const workspaceId = db.saveWorkspace({
      companyId,
      name: "Primary",
      localPath: profileDir,
      repoUrl: "",
      repoRef: "",
      isPrimary: true,
    });

    const ceoId = db.saveAgent({
      companyId,
      name: "CEO",
      role: "CEO",
      title: "Chief Executive Officer",
      status: "active",
      reportsTo: null,
      connectorId: "codex_local",
      workspaceId,
      model: null,
      capabilities: "Lead the company",
      budgetMonthlyUsd: 250,
    });
    const ctoId = db.saveAgent({
      companyId,
      name: "CTO",
      role: "CTO",
      title: "Chief Technology Officer",
      status: "active",
      reportsTo: ceoId,
      connectorId: "codex_local",
      workspaceId,
      model: null,
      capabilities: "Lead engineering",
      budgetMonthlyUsd: 220,
      department: "engineering",
    });
    const engineerId = db.saveAgent({
      companyId,
      name: "Engineer",
      role: "Engineer",
      title: "Software Engineer",
      status: "active",
      reportsTo: ceoId,
      connectorId: "codex_local",
      workspaceId,
      model: null,
      capabilities: "Build features",
      budgetMonthlyUsd: 180,
      department: "engineering",
    });

    expect(canManageOrganization(db, companyId, ceoId)).toBe(true);
    expect(canManageOrganization(db, companyId, ctoId)).toBe(false);
    expect(canRequestHire(db, companyId, ctoId)).toBe(true);
    expect(canManageOrganization(db, companyId, engineerId)).toBe(false);
    expect(canRequestHire(db, companyId, engineerId)).toBe(false);

    db.close();
  });

  it("allows explicit organization_manage permission to grant recursive org authority", async () => {
    const profileDir = await createTempDir("agentcompany-agent-perms-override-");
    const db = new AppDatabase(profileDir);
    db.init();

    const companyId = db.saveCompany({
      name: "Org Permission Override Co",
      description: "Tests permission-based org authority",
      status: "active",
    });
    const workspaceId = db.saveWorkspace({
      companyId,
      name: "Primary",
      localPath: profileDir,
      repoUrl: "",
      repoRef: "",
      isPrimary: true,
    });
    const ceoId = db.saveAgent({
      companyId,
      name: "CEO",
      role: "CEO",
      title: "Chief Executive Officer",
      status: "active",
      reportsTo: null,
      connectorId: "codex_local",
      workspaceId,
      model: null,
      capabilities: "Lead the company",
      budgetMonthlyUsd: 250,
    });
    const agentId = db.saveAgent({
      companyId,
      name: "Operations Lead",
      role: "Specialist",
      title: "Operations Specialist",
      status: "active",
      reportsTo: ceoId,
      connectorId: "codex_local",
      workspaceId,
      model: null,
      capabilities: "Coordinate operations",
      budgetMonthlyUsd: 180,
      department: "operations",
    });

    expect(canManageOrganization(db, companyId, agentId)).toBe(false);
    db.setAgentPermission(agentId, companyId, "organization_manage", true);
    expect(canManageOrganization(db, companyId, agentId)).toBe(true);
    expect(canRequestHire(db, companyId, agentId)).toBe(true);

    db.close();
  });

  it("manager subtree growth does not become org-wide admin after the first hire", async () => {
    const profileDir = await createTempDir("agentcompany-agent-perms-scope-");
    const db = new AppDatabase(profileDir);
    db.init();

    const companyId = db.saveCompany({
      name: "Scoped Authority Co",
      description: "Tests that branch growth does not unlock org-wide admin powers",
      status: "active",
    });
    const workspaceId = db.saveWorkspace({
      companyId,
      name: "Primary",
      localPath: profileDir,
      repoUrl: "",
      repoRef: "",
      isPrimary: true,
    });
    const ceoId = db.saveAgent({
      companyId,
      name: "CEO",
      role: "CEO",
      title: "Chief Executive Officer",
      status: "active",
      reportsTo: null,
      connectorId: "codex_local",
      workspaceId,
      model: null,
      capabilities: "Lead the company",
      budgetMonthlyUsd: 250,
    });
    const ctoId = db.saveAgent({
      companyId,
      name: "CTO",
      role: "CTO",
      title: "Chief Technology Officer",
      status: "active",
      reportsTo: ceoId,
      connectorId: "codex_local",
      workspaceId,
      model: null,
      capabilities: "Lead engineering",
      budgetMonthlyUsd: 220,
      department: "engineering",
    });
    const cmoId = db.saveAgent({
      companyId,
      name: "CMO",
      role: "CMO",
      title: "Chief Marketing Officer",
      status: "active",
      reportsTo: ceoId,
      connectorId: "codex_local",
      workspaceId,
      model: null,
      capabilities: "Lead marketing",
      budgetMonthlyUsd: 220,
      department: "marketing",
    });
    const ctoReportId = db.saveAgent({
      companyId,
      name: "Engineer",
      role: "Engineer",
      title: "Frontend Engineer",
      status: "active",
      reportsTo: ctoId,
      connectorId: "codex_local",
      workspaceId,
      model: null,
      capabilities: "Build frontend features",
      budgetMonthlyUsd: 180,
      department: "engineering",
    });

    const cmoTaskId = db.saveTask({
      companyId,
      title: "Launch campaign",
      description: "Owned by the marketing branch",
      assigneeAgentId: cmoId,
      workspaceId,
      priority: "high",
      status: "todo",
    });
    expect(canRequestHire(db, companyId, ctoId)).toBe(true);
    expect(canManageOrganization(db, companyId, ctoId)).toBe(false);
    expect(canControlAgent(db, companyId, ctoId, ctoReportId)).toBe(true);
    expect(canControlAgent(db, companyId, ctoId, cmoId)).toBe(false);
    expect(canAssignTask(db, companyId, ctoId, ctoReportId)).toBe(true);
    expect(canAssignTask(db, companyId, ctoId, cmoId)).toBe(false);
    expect(canManageGoal(db, companyId, ctoId, cmoId)).toBe(false);
    expect(canManageProject(db, companyId, ctoId, cmoId)).toBe(false);
    expect(canManageGoal(db, companyId, ceoId, cmoId)).toBe(true);
    expect(canManageProject(db, companyId, ceoId, cmoId)).toBe(true);
    expect(db.getTask(cmoTaskId).assigneeAgentId).toBe(cmoId);

    db.close();
  });
});
