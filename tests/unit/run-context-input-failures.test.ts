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
import { createBudgetEnforcementService } from "../../src/main/budget-enforcement-service";
import { createRunDispatch } from "../../src/main/orchestration/run-dispatch";
import { createTaskRunner } from "../../src/main/orchestration/task-runner";
import type { OrchestrationDependencies } from "../../src/main/orchestration/types";

function createLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createCompanyRunFixture(db: AppDatabase, profileDir: string) {
  db.connectorsCrud.updateConnectorHealth({
    id: "openai-codex",
    status: "ready",
    authState: "authenticated",
    version: "test",
    lastError: null,
  });
  const companyId = db.company.saveCompany({
    name: "Context Integrity Co",
    description: "Validates run context failures",
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
  const agentId = db.agents.saveAgent({
    companyId,
    name: "Runtime Engineer",
    role: "Engineer",
    title: "Runtime Engineer",
    status: "idle",
    reportsTo: null,
    connectorId: "openai-codex",
    workspaceId,
    model: "gpt-5.4",
    capabilities: "Ships runtime fixes",
    budgetMonthlyUsd: 250,
  });
  const taskId = db.tasks.saveTask({
    companyId,
    title: "Assemble safe run context",
    description: "The worker must start only with a complete context.",
    assigneeAgentId: agentId,
    workspaceId,
    priority: "high",
    status: "todo",
    requiresFilesystem: true,
  });
  return { companyId, workspaceId, agentId, taskId };
}

function createHarness(
  db: AppDatabase,
  overrides: Partial<Pick<OrchestrationDependencies, "listRuntimeSkillEntries" | "getSessionHandoff">> = {},
) {
  const logger = createLogger();
  const enqueueWorkerRun = vi.fn();
  const emitEvent = vi.fn();
  const budgetService = createBudgetEnforcementService({
    db,
    logger,
    notify: vi.fn(),
    publishDomainChanged: vi.fn(),
  });
  const deps: OrchestrationDependencies = {
    db,
    logger,
    publishDomainChanged: vi.fn(),
    emitEvent,
    notify: vi.fn(),
    createRunToken: () => "test-token",
    getApiPort: () => 3210,
    dispatchAutomation: vi.fn(),
    hasWorkerReady: () => true,
    enqueueWorkerRun,
    isQuitting: () => false,
    listRuntimeSkillEntries: () => [],
    budgetService,
    checkpointEngine: { shouldPauseHeartbeat: () => false },
    ...overrides,
  };
  const runDispatch = createRunDispatch(deps);
  const taskRunner = createTaskRunner(
    deps,
    runDispatch.resolveWorkspace,
    runDispatch.getRunEligibilityFailure,
    runDispatch.dispatchRunToWorker,
    (filter) => db.runs.hasActiveRun(filter),
  );
  return { enqueueWorkerRun, emitEvent, logger, taskRunner };
}

describe("run context input failures", () => {
  let tempDir: string;
  let db: AppDatabase;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-context-input-"));
    db = new AppDatabase(tempDir);
    db.init();
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("fails the run before worker enqueue when managed skills cannot load", () => {
    const { taskId } = createCompanyRunFixture(db, tempDir);
    const { enqueueWorkerRun, emitEvent, taskRunner } = createHarness(db, {
      listRuntimeSkillEntries: () => {
        throw new Error("skill database unavailable");
      },
    });

    const result = taskRunner.queueTaskRun(taskId, "manual", "unit-test");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected the task runner to persist a failed run.");
    }
    expect(enqueueWorkerRun).not.toHaveBeenCalled();
    const run = db.runs.getRun(result.data);
    const task = db.entityCrud.getTask(taskId);
    const workspace = db.workspacesMod.getWorkspace(task.workspaceId);
    expect(run.status).toBe("failed");
    expect(run.errorMessage).toContain("run.skills.fetch_failed");
    expect(task.status).toBe("todo");
    expect(task.activeRunId).toBeNull();
    expect(workspace?.state).toBe("ready");
    expect(emitEvent).toHaveBeenCalledWith({ type: "run-updated", runId: run.id, action: "completed" });
    expect(emitEvent).not.toHaveBeenCalledWith({ type: "run-updated", runId: run.id, action: "created" });
  });

  it("fails the run before worker enqueue when session handoff cannot load", () => {
    const { taskId } = createCompanyRunFixture(db, tempDir);
    const { enqueueWorkerRun, emitEvent, taskRunner } = createHarness(db, {
      getSessionHandoff: () => {
        throw new Error("session handoff store unavailable");
      },
    });

    const result = taskRunner.queueTaskRun(taskId, "manual", "unit-test");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected the task runner to persist a failed run.");
    }
    expect(enqueueWorkerRun).not.toHaveBeenCalled();
    const run = db.runs.getRun(result.data);
    const task = db.entityCrud.getTask(taskId);
    expect(run.status).toBe("failed");
    expect(run.errorMessage).toContain("run.session_handoff.load_failed");
    expect(task.status).toBe("todo");
    expect(task.activeRunId).toBeNull();
    expect(emitEvent).toHaveBeenCalledWith({ type: "run-updated", runId: run.id, action: "completed" });
    expect(emitEvent).not.toHaveBeenCalledWith({ type: "run-updated", runId: run.id, action: "created" });
  });
});
