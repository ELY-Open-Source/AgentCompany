import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../../src/main/database";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("agent budget policy synchronization", () => {
  it("updates the canonical agent-scope policy instead of creating duplicate active policies", async () => {
    const profileDir = await createTempDir("agentcompany-budget-sync-");
    const db = new AppDatabase(profileDir);
    db.init();

    const companyId = db.saveCompany({
      name: "Budget Sync Co",
      description: "Budget sync regression coverage",
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
    const agentId = db.agents.saveAgent({
      companyId,
      name: "Engineer",
      role: "Engineer",
      title: "Backend Engineer",
      status: "active",
      reportsTo: null,
      connectorId: "openai-codex",
      workspaceId,
      model: null,
      capabilities: "Build backend services",
      budgetMonthlyUsd: 100,
      department: "engineering",
    });

    const firstPolicyId = db.saveBudgetPolicy({
      companyId,
      scopeType: "agent",
      scopeId: agentId,
      metric: "billed_cents",
      windowKind: "calendar_month_utc",
      amount: 10_000,
      warnPercent: 80,
      hardStopEnabled: true,
      notifyEnabled: true,
      isActive: true,
    });

    db.agents.saveAgent({
      id: agentId,
      companyId,
      name: "Engineer",
      role: "Engineer",
      title: "Backend Engineer",
      status: "active",
      reportsTo: null,
      connectorId: "openai-codex",
      workspaceId,
      model: null,
      capabilities: "Build backend services",
      budgetMonthlyUsd: 250,
      department: "engineering",
    });

    const secondPolicyId = db.saveBudgetPolicy({
      companyId,
      scopeType: "agent",
      scopeId: agentId,
      metric: "billed_cents",
      windowKind: "calendar_month_utc",
      amount: 25_000,
      warnPercent: 80,
      hardStopEnabled: true,
      notifyEnabled: true,
      isActive: true,
    });

    const agentPolicies = db.listBudgetPolicies(companyId).filter(
      (policy) => policy.scopeType === "agent" && policy.scopeId === agentId,
    );
    expect(secondPolicyId).toBe(firstPolicyId);
    expect(agentPolicies).toHaveLength(1);
    expect(agentPolicies[0]?.amount).toBe(25_000);
    expect(db.getActivePoliciesForRun(companyId, agentId, null).map((policy) => policy.amount)).toEqual([25_000]);

    db.close();
  });
});
