import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => "basic_text",
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

import { AppDatabase } from "../../src/main/database";

type RawDb = {
  db: {
    prepare: (sql: string) => {
      get: (...args: unknown[]) => unknown;
    };
  };
};

function createCompany(db: AppDatabase): string {
  return db.core.company.saveCompany({
    name: "Run Log Atomicity Co",
    description: "Run log creation tests",
    status: "active",
  });
}

function createConnector(db: AppDatabase): void {
  db.core.connectors.saveConnector({
    id: "openai-codex",
    model: "gpt-5",
    envBindingText: "",
    notes: "Test connector",
  });
}

function createWorkspace(db: AppDatabase, companyId: string): string {
  return db.core.workspaces.saveWorkspace({
    companyId,
    name: "Workspace",
    localPath: "/tmp/run-log-atomicity",
    repoUrl: "",
    repoRef: "",
    isPrimary: true,
  });
}

function createAgent(db: AppDatabase, companyId: string, workspaceId: string): string {
  return db.core.agents.saveAgent({
    companyId,
    name: "Agent",
    role: "IC",
    title: "Agent",
    status: "active",
    reportsTo: null,
    connectorId: "openai-codex",
    workspaceId,
    model: null,
    capabilities: "Executes tasks",
    budgetMonthlyUsd: 100,
  });
}

function createTask(db: AppDatabase, companyId: string, agentId: string | null, workspaceId: string): string {
  return db.core.tasks.saveTask({
    companyId,
    title: "Task",
    description: "A task",
    assigneeAgentId: agentId,
    workspaceId,
    priority: "medium",
    status: "todo",
  });
}

describe("run log creation atomicity", () => {
  let tempDir: string;
  let db: AppDatabase;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-run-log-"));
    db = new AppDatabase(tempDir);
    db.init();
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("createRun rejects before inserting the run row when the log path is unavailable", () => {
    const companyId = createCompany(db);
    createConnector(db);
    const workspaceId = createWorkspace(db, companyId);
    const agentId = createAgent(db, companyId, workspaceId);
    const taskId = createTask(db, companyId, null, workspaceId);
    const blockedRunId = randomUUID();
    mkdirSync(join(db.logsDir, `${blockedRunId}.log`));

    expect(() =>
      db.core.runs.createRun({
        id: blockedRunId,
        companyId,
        taskId,
        agentId,
        workspaceId,
        connectorId: "openai-codex",
      }),
    ).toThrow();

    const storedRun = (db as unknown as RawDb).db
      .prepare("SELECT id FROM runs WHERE id = ?")
      .get(blockedRunId);
    expect(storedRun).toBeUndefined();
    const task = db.core.entity.getTask(taskId);
    expect(task.activeRunId).toBeNull();
    expect(task.status).toBe("todo");
  });

  it("createTaskRun removes the empty log when checkout loses the race", () => {
    const companyId = createCompany(db);
    createConnector(db);
    const workspaceId = createWorkspace(db, companyId);
    const agentId = createAgent(db, companyId, workspaceId);
    const taskId = createTask(db, companyId, null, workspaceId);
    const firstRun = db.core.runs.createTaskRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });
    expect(firstRun).not.toBeNull();

    const losingRunId = randomUUID();
    const secondRun = db.core.runs.createTaskRun({
      id: losingRunId,
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });

    expect(secondRun).toBeNull();
    expect(existsSync(join(db.logsDir, `${losingRunId}.log`))).toBe(false);
  });
});
