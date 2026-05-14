import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
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
import { handleWorkerExit, requeueQueuedRunsAfterWorkerRestart } from "../../src/main/worker/entry/crash-recovery";

function createLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createCompany(db: AppDatabase): string {
  return db.core.company.saveCompany({
    name: "Crash Recovery Co",
    description: "Worker crash recovery contract test",
    status: "active",
  });
}

function createConnector(db: AppDatabase): void {
  db.core.connectors.saveConnector({
    id: "openai-codex",
    model: "gpt-5.4",
    envBindingText: "",
    notes: "Test connector",
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
    name: "Recovery Agent",
    role: "Engineer",
    title: "Engineer",
    status: "active",
    reportsTo: null,
    connectorId: "openai-codex",
    workspaceId,
    model: "gpt-5.4",
    capabilities: "Continues work after runtime crashes",
    budgetMonthlyUsd: 100,
  });
}

describe("worker crash recovery", () => {
  let tempDir: string;
  let db: AppDatabase;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-worker-crash-"));
    db = new AppDatabase(tempDir);
    db.init();
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns interrupted running tasks to checkoutable work and wakes the original agent", () => {
    const companyId = createCompany(db);
    createConnector(db);
    const workspaceId = createWorkspace(db, companyId, tempDir);
    const agentId = createAgent(db, companyId, workspaceId);
    const taskId = db.core.tasks.saveTask({
      companyId,
      title: "Continue Phase 2",
      description: "This task must remain recoverable after the worker process exits.",
      assigneeAgentId: agentId,
      workspaceId,
      priority: "high",
      status: "todo",
    });
    const run = db.core.runs.createTaskRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });
    expect(run).not.toBeNull();
    db.core.runs.markRunStatus(run!.id, "running", "Started");
    expect(db.core.entity.getTask(taskId).status).toBe("in_progress");
    expect(db.core.runs.hasActiveRun({ companyId, agentId })).toBe(true);

    const wakeAgentIfPossible = vi.fn(() => null);
    handleWorkerExit(
      1,
      {
        db,
        logger: createLogger(),
        isQuitting: () => false,
        publishDomainChanged: vi.fn(),
        emitEvent: vi.fn(),
        wakeAgentIfPossible,
      },
    );

    expect(db.core.runs.getRun(run!.id).status).toBe("interrupted");
    expect(db.core.entity.getTask(taskId).status).toBe("todo");
    expect(db.core.runs.hasActiveRun({ companyId, agentId })).toBe(false);
    expect(wakeAgentIfPossible).toHaveBeenCalledWith(agentId, companyId, "recovery");

    const retryRun = db.core.runs.createTaskRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });
    expect(retryRun).not.toBeNull();
  });

  it("requeues queued runs after the replacement worker is ready", () => {
    const companyId = createCompany(db);
    createConnector(db);
    const workspaceId = createWorkspace(db, companyId, tempDir);
    const agentId = createAgent(db, companyId, workspaceId);
    const taskId = db.core.tasks.saveTask({
      companyId,
      title: "Queued recovery task",
      description: "This run was queued when the worker process exited.",
      assigneeAgentId: agentId,
      workspaceId,
      priority: "high",
      status: "todo",
    });
    const run = db.core.runs.createTaskRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });
    expect(run).not.toBeNull();
    expect(db.core.runs.getRun(run!.id).status).toBe("queued");
    expect(db.core.runs.hasActiveRun({ companyId, agentId })).toBe(true);

    const dispatchRunToWorker = vi.fn();
    const requeueCandidates = handleWorkerExit(
      1,
      {
        db,
        logger: createLogger(),
        isQuitting: () => false,
        publishDomainChanged: vi.fn(),
        emitEvent: vi.fn(),
        wakeAgentIfPossible: vi.fn(() => null),
      },
    );

    expect(dispatchRunToWorker).not.toHaveBeenCalled();
    expect(requeueCandidates).toHaveLength(1);
    expect(db.core.runs.getRun(run!.id).status).toBe("queued");

    requeueQueuedRunsAfterWorkerRestart(
      requeueCandidates,
      {
        db,
        logger: createLogger(),
        dispatchRunToWorker,
      },
    );

    expect(dispatchRunToWorker).toHaveBeenCalledOnce();
    expect(dispatchRunToWorker).toHaveBeenCalledWith(expect.objectContaining({
      runId: run!.id,
      companyId,
      task: expect.objectContaining({ id: taskId }),
      agent: expect.objectContaining({ id: agentId }),
      trigger: "recovery",
    }));
    expect(db.core.runs.hasActiveRun({ companyId, agentId })).toBe(true);
  });
});
