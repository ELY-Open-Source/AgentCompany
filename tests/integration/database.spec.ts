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

describe("AppDatabase", () => {
  it("persists core entities, secrets, run logs, and backup restore state", async () => {
    const profileDir = await createTempDir("agentcompany-profile-");
    const backupDir = await createTempDir("agentcompany-backup-");
    const db = new AppDatabase(profileDir);
    db.init();

    const companyId = db.saveCompany({
      name: "Orbit Foundry",
      description: "Test company",
      status: "active",
    });

    const workspaceId = db.saveWorkspace({
      companyId,
      name: "Primary",
      localPath: profileDir,
      repoUrl: "https://example.com/repo.git",
      repoRef: "main",
      isPrimary: true,
    });

    const agentId = db.saveAgent({
      companyId,
      name: "Helios",
      role: "CEO",
      title: "Lead agent",
      status: "active",
      reportsTo: null,
      connectorId: "codex_local",
      workspaceId,
      model: null,
      capabilities: "Operate the company",
      budgetMonthlyUsd: 200,
    });

    const goalId = db.saveGoal({
      companyId,
      title: "Ship the desktop app",
      description: "Reach packaged desktop parity.",
      ownerAgentId: agentId,
      status: "active",
    });

    const projectId = db.saveProject({
      companyId,
      goalId,
      name: "Desktop rebuild",
      description: "Rebuild as Electron desktop app.",
      leadAgentId: agentId,
      status: "in_progress",
    });

    const taskId = db.saveTask({
      companyId,
      projectId,
      goalId,
      title: "Validate connector state",
      description: "Run a health check and capture output.",
      assigneeAgentId: agentId,
      workspaceId,
      priority: "high",
      status: "todo",
    });

    db.saveSecret({
      companyId,
      name: "vault-openai",
      description: "Test key",
      value: "sk-test-123",
    });

    db.saveConnector({
      id: "codex_local",
      command: "codex",
      model: null,
      envBindingText: "OPENAI_API_KEY=vault-openai",
      notes: "Connector note",
    });

    expect(db.resolveSecretEnv("OPENAI_API_KEY=vault-openai", companyId)).toEqual({
      OPENAI_API_KEY: "sk-test-123",
    });

    const run = db.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "codex_local",
    });

    await db.appendRunLog(run.id, "stdout", "hello from run\n");
    expect(db.readRunLog(run.id)).toContain("hello from run");

    db.markRunStatus(run.id, "running", "Connector launched");
    db.finishRun({
      runId: run.id,
      status: "succeeded",
      summary: "Completed successfully",
      errorMessage: null,
      exitCode: 0,
      signal: null,
      model: "gpt-5-codex",
      sessionDisplayId: "session-1",
      costUsd: 12.5,
      unattributedCost: false,
    });

    const snapshotBeforeBackup = db.listSnapshot();
    expect(snapshotBeforeBackup.companies).toHaveLength(1);
    expect(snapshotBeforeBackup.runs[0]?.status).toBe("succeeded");
    expect(snapshotBeforeBackup.tasks[0]?.activeRunId).toBeNull();

    await db.exportBackup(backupDir);

    db.saveCompany({
      name: "Temporary company",
      description: "Should disappear after restore",
      status: "active",
    });
    expect(db.listSnapshot().companies).toHaveLength(2);

    await db.restoreFromBackup(backupDir);
    const restoredSnapshot = db.listSnapshot();
    expect(restoredSnapshot.companies).toHaveLength(1);
    expect(restoredSnapshot.companies[0]?.name).toBe("Orbit Foundry");
    expect(restoredSnapshot.runs[0]?.summary).toBe("Completed successfully");

    db.close();
  });

  it("returns a renderer snapshot scoped to the current company while preserving global selectors", async () => {
    const profileDir = await createTempDir("agentcompany-renderer-snapshot-");
    const db = new AppDatabase(profileDir);
    db.init();

    const alphaCompanyId = db.saveCompany({
      name: "Alpha",
      description: "Alpha company",
      status: "active",
    });

    const betaCompanyId = db.saveCompany({
      name: "Beta",
      description: "Beta company",
      status: "active",
    });

    const alphaWorkspaceId = db.saveWorkspace({
      companyId: alphaCompanyId,
      name: "Alpha Workspace",
      localPath: profileDir,
      repoUrl: "",
      repoRef: "",
      isPrimary: true,
    });

    const betaWorkspaceId = db.saveWorkspace({
      companyId: betaCompanyId,
      name: "Beta Workspace",
      localPath: profileDir,
      repoUrl: "",
      repoRef: "",
      isPrimary: true,
    });

    const alphaAgentId = db.saveAgent({
      companyId: alphaCompanyId,
      name: "Alpha CEO",
      role: "CEO",
      title: "",
      status: "active",
      reportsTo: null,
      connectorId: "codex_local",
      workspaceId: alphaWorkspaceId,
      model: null,
      capabilities: "Lead alpha",
      budgetMonthlyUsd: 100,
    });

    db.saveAgent({
      companyId: betaCompanyId,
      name: "Beta CEO",
      role: "CEO",
      title: "",
      status: "active",
      reportsTo: null,
      connectorId: "codex_local",
      workspaceId: betaWorkspaceId,
      model: null,
      capabilities: "Lead beta",
      budgetMonthlyUsd: 100,
    });

    db.saveTask({
      companyId: alphaCompanyId,
      title: "Alpha task",
      description: "Alpha work",
      assigneeAgentId: alphaAgentId,
      workspaceId: alphaWorkspaceId,
      priority: "medium",
      status: "todo",
    });

    db.saveTask({
      companyId: betaCompanyId,
      title: "Beta task",
      description: "Beta work",
      assigneeAgentId: null,
      workspaceId: betaWorkspaceId,
      priority: "medium",
      status: "todo",
    });

    db.setCurrentCompany(alphaCompanyId);

    const rendererSnapshot = db.listRendererSnapshot();
    expect(rendererSnapshot.currentCompanyId).toBe(alphaCompanyId);
    expect(rendererSnapshot.companies).toHaveLength(2);
    expect(rendererSnapshot.connectors.length).toBeGreaterThan(0);
    expect(rendererSnapshot.workspaces.map((workspace) => workspace.companyId)).toEqual([alphaCompanyId]);
    expect(rendererSnapshot.agents.every((agent) => agent.companyId === alphaCompanyId)).toBe(true);
    expect(rendererSnapshot.tasks.every((task) => task.companyId === alphaCompanyId)).toBe(true);

    db.close();
  });
});
