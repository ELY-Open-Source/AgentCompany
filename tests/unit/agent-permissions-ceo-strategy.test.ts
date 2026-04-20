import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../../src/main/database";
import { canFileCeoStrategy, canRequestHire } from "../../src/main/agent-permissions";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function setupCompany(prefix: string) {
  const profileDir = await createTempDir(prefix);
  const db = new AppDatabase(profileDir);
  db.init();

  const companyId = db.company.saveCompany({
    name: "CEO Strategy Co",
    description: "Tests canFileCeoStrategy orthogonality",
    status: "active",
  });
  const workspaceId = db.workspacesMod.saveWorkspace({
    companyId,
    name: "Primary",
    localPath: profileDir,
    repoUrl: "",
    repoRef: "",
    isPrimary: true,
  });

  return { db, companyId, workspaceId };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("canFileCeoStrategy", () => {
  it("returns true for a genuine CEO who reports to the board", async () => {
    const { db, companyId, workspaceId } = await setupCompany("agentcompany-ceo-strategy-real-");

    const ceoId = db.agents.saveAgent({
      companyId,
      name: "Ada",
      role: "CEO",
      title: "Chief Executive Officer",
      status: "active",
      reportsTo: null,
      connectorId: "openai-codex",
      workspaceId,
      model: null,
      capabilities: "Lead the company",
      budgetMonthlyUsd: 250,
    });

    expect(canFileCeoStrategy(db, companyId, ceoId)).toBe(true);

    db.close();
  });

  it("returns false for a CEO-titled agent with a virtual superior", async () => {
    const { db, companyId, workspaceId } = await setupCompany("agentcompany-ceo-strategy-virtual-");

    const boardId = db.agents.saveAgent({
      companyId,
      name: "Board Proxy",
      role: "Board",
      title: "Board Representative",
      status: "active",
      reportsTo: null,
      connectorId: "openai-codex",
      workspaceId,
      model: null,
      capabilities: "Hold CEO accountable",
      budgetMonthlyUsd: 100,
    });
    const ceoId = db.agents.saveAgent({
      companyId,
      name: "Ada",
      role: "CEO",
      title: "Chief Executive Officer",
      status: "active",
      reportsTo: boardId,
      connectorId: "openai-codex",
      workspaceId,
      model: null,
      capabilities: "Lead the company",
      budgetMonthlyUsd: 250,
    });

    expect(canFileCeoStrategy(db, companyId, ceoId)).toBe(false);

    db.close();
  });

  it("returns false for a VP with no manager (role is not CEO)", async () => {
    const { db, companyId, workspaceId } = await setupCompany("agentcompany-ceo-strategy-vp-");

    const vpId = db.agents.saveAgent({
      companyId,
      name: "Kai",
      role: "VP Product",
      title: "Vice President of Product",
      status: "active",
      reportsTo: null,
      connectorId: "openai-codex",
      workspaceId,
      model: null,
      capabilities: "Own product strategy",
      budgetMonthlyUsd: 220,
      department: "product",
    });

    expect(canFileCeoStrategy(db, companyId, vpId)).toBe(false);
    expect(canRequestHire(db, companyId, vpId)).toBe(true);

    db.close();
  });

  it("returns false for a plain IC", async () => {
    const { db, companyId, workspaceId } = await setupCompany("agentcompany-ceo-strategy-ic-");

    const ceoId = db.agents.saveAgent({
      companyId,
      name: "Ada",
      role: "CEO",
      title: "Chief Executive Officer",
      status: "active",
      reportsTo: null,
      connectorId: "openai-codex",
      workspaceId,
      model: null,
      capabilities: "Lead the company",
      budgetMonthlyUsd: 250,
    });
    const icId = db.agents.saveAgent({
      companyId,
      name: "Eve",
      role: "Engineer",
      title: "Software Engineer",
      status: "active",
      reportsTo: ceoId,
      connectorId: "openai-codex",
      workspaceId,
      model: null,
      capabilities: "Build features",
      budgetMonthlyUsd: 180,
      department: "engineering",
    });

    expect(canFileCeoStrategy(db, companyId, icId)).toBe(false);

    db.close();
  });
});
