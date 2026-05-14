import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "../../src/main/database";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => "basic_text",
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

type RawDb = {
  db: {
    prepare: (sql: string) => {
      run: (...args: unknown[]) => void;
    };
  };
};

function createCompany(db: AppDatabase): string {
  return db.core.company.saveCompany({
    name: "Projection Co",
    description: "Active run projection contract",
    status: "active",
  });
}

function createWorkspace(db: AppDatabase, companyId: string, localPath: string): string {
  return db.core.workspaces.saveWorkspace({
    companyId,
    name: "Primary",
    localPath,
    repoUrl: "",
    repoRef: "",
    isPrimary: true,
  });
}

function createAgent(db: AppDatabase, companyId: string, workspaceId: string): string {
  return db.core.agents.saveAgent({
    companyId,
    name: "Projection Agent",
    role: "Engineer",
    title: "Engineer",
    status: "idle",
    reportsTo: null,
    connectorId: "openai-codex",
    workspaceId,
    model: "gpt-5.4",
    capabilities: "Tests active run projections",
    budgetMonthlyUsd: 100,
  });
}

describe("active run projection", () => {
  let tempDir: string;
  let db: AppDatabase;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-active-run-projection-"));
    db = new AppDatabase(tempDir);
    db.init();
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("ignores terminal run leases when projecting activeRunId", () => {
    const companyId = createCompany(db);
    const workspaceId = createWorkspace(db, companyId, tempDir);
    const agentId = createAgent(db, companyId, workspaceId);
    const taskId = db.core.tasks.saveTask({
      companyId,
      title: "Recoverable task",
      description: "A stale terminal lease must not hide this task from recovery.",
      assigneeAgentId: agentId,
      workspaceId,
      priority: "high",
      status: "todo",
    });
    const run = db.core.runs.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId: null,
      connectorId: "openai-codex",
    });
    db.core.runs.finishRun({
      runId: run.id,
      status: "succeeded",
      summary: "Done",
      errorMessage: null,
      exitCode: 0,
      signal: null,
      model: null,
      unattributedCost: true,
    });
    const now = new Date().toISOString();
    (db as unknown as RawDb).db
      .prepare(
        `insert into task_leases (
          task_id, company_id, run_id, agent_id, acquired_at, renewed_at, expires_at, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(taskId, companyId, run.id, agentId, now, now, now, now, now);

    expect(db.core.entity.getTask(taskId).activeRunId).toBeNull();
    expect(db.core.tasks.listAgentTasks(agentId, companyId, ["todo"])[0]?.activeRunId).toBeNull();
    expect(db.projection.snapshot.listSnapshot({ companyId }).tasks.find((task) => task.id === taskId)?.activeRunId).toBeNull();
  });
});
