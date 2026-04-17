import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../../src/main/database";
import { getHireRoutingValidationError, resolveHireReportsTo } from "../../src/main/agent-permissions";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("hire routing guards", () => {
  it("defaults same-department hires to the requester and infers department leads for cross-department hires", async () => {
    const profileDir = await createTempDir("agentcompany-hire-manager-");
    const db = new AppDatabase(profileDir);
    db.init();

    const companyId = db.saveCompany({
      name: "Routing Co",
      description: "Hire routing regression coverage",
      status: "active",
    });
    db.updateConnectorHealth({
      id: "openai-codex",
      status: "ready",
      authState: "authenticated",
      version: "test",
      lastError: null,
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
      connectorId: "openai-codex",
      workspaceId,
      model: null,
      capabilities: "Lead the company",
      budgetMonthlyUsd: 250,
      department: "executive",
    });
    const hrId = db.saveAgent({
      companyId,
      name: "HR Lead",
      role: "HR Lead",
      title: "Head of HR",
      status: "active",
      reportsTo: ceoId,
      connectorId: "openai-codex",
      workspaceId,
      model: null,
      capabilities: "Run hiring operations",
      budgetMonthlyUsd: 180,
      department: "hr",
    });
    const ctoId = db.saveAgent({
      companyId,
      name: "CTO",
      role: "CTO",
      title: "Chief Technology Officer",
      status: "active",
      reportsTo: ceoId,
      connectorId: "openai-codex",
      workspaceId,
      model: null,
      capabilities: "Lead engineering",
      budgetMonthlyUsd: 220,
      department: "engineering",
    });

    expect(resolveHireReportsTo(db, companyId, hrId, undefined, "hr")).toBe(hrId);
    expect(resolveHireReportsTo(db, companyId, hrId, undefined, "engineering")).toBe(ctoId);
    expect(getHireRoutingValidationError(db, companyId, hrId, hrId, "engineering")).toBe(
      "Selected manager must belong to the same department as the new hire, unless they are a top-level executive.",
    );
    expect(getHireRoutingValidationError(db, companyId, ctoId, ctoId, "engineering")).toBeNull();

    db.close();
  });
});
