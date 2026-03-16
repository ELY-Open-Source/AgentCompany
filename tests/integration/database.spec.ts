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
});
