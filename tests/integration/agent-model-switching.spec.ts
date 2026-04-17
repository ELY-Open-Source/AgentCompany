import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "../../src/main/database";
import { createBudgetEnforcementService } from "../../src/main/budget-enforcement-service";
import { createRunDispatch } from "../../src/main/orchestration/run-dispatch";
import { createTaskRunner } from "../../src/main/orchestration/task-runner";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function createHarness(db: AppDatabase) {
  const enqueueWorkerRun = vi.fn();
  const budgetService = createBudgetEnforcementService({
    db,
    logger,
    notify: vi.fn(),
    publishDomainChanged: vi.fn(),
  });

  const deps = {
    db,
    logger,
    publishDomainChanged: vi.fn(),
    emitEvent: vi.fn(),
    notify: vi.fn(),
    createRunToken: () => "token",
    getApiPort: () => 3210,
    dispatchAutomation: vi.fn(),
    hasWorkerReady: () => true,
    enqueueWorkerRun,
    isQuitting: () => false,
    listRuntimeSkillEntries: () => [],
    budgetService,
    checkpointEngine: { shouldPauseHeartbeat: () => false },
  };

  const runDispatch = createRunDispatch(deps);
  const taskRunner = createTaskRunner(
    deps,
    runDispatch.resolveWorkspace,
    runDispatch.getRunEligibilityFailure,
    runDispatch.dispatchRunToWorker,
    (filter) => db.hasActiveRun(filter),
  );

  return { enqueueWorkerRun, taskRunner };
}

describe("agent model switching", () => {
  it("uses the agent's updated model for subsequent runtime dispatches", async () => {
    const profileDir = await createTempDir("agentcompany-model-switching-");
    const db = new AppDatabase(profileDir);
    db.init();

    db.updateConnectorHealth({
      id: "openai-codex",
      status: "ready",
      authState: "authenticated",
      version: "test",
      lastError: null,
    });

    const companyId = db.saveCompany({
      name: "Model Switch Co",
      description: "Tests post-hire model switching",
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
    const agentId = db.saveAgent({
      companyId,
      name: "Engineer",
      role: "Engineer",
      title: "Frontend Engineer",
      status: "idle",
      reportsTo: null,
      connectorId: "openai-codex",
      workspaceId,
      model: "gpt-5.4",
      capabilities: "Build frontend features",
      budgetMonthlyUsd: 200,
    });

    const { enqueueWorkerRun, taskRunner } = createHarness(db);

    const firstTaskId = db.saveTask({
      companyId,
      title: "Initial model task",
      description: "Use the first model for this run.",
      assigneeAgentId: agentId,
      workspaceId,
      priority: "high",
      status: "todo",
    });

    const firstRun = taskRunner.queueTaskRun(firstTaskId, "manual", "board");
    expect(firstRun.ok).toBe(true);
    expect(enqueueWorkerRun).toHaveBeenCalledTimes(1);
    expect(enqueueWorkerRun.mock.calls[0]?.[0]?.model).toBe("gpt-5.4");

    if (!firstRun.ok) {
      throw new Error("Expected first run to queue successfully.");
    }

    db.finishRun({
      runId: firstRun.data,
      status: "succeeded",
      summary: "Done",
      errorMessage: null,
      exitCode: 0,
      signal: null,
      model: "gpt-5.4",
      sessionDisplayId: null,
      unattributedCost: true,
    });

    db.saveAgent({
      id: agentId,
      companyId,
      name: "Engineer",
      role: "Engineer",
      title: "Frontend Engineer",
      status: "idle",
      reportsTo: null,
      connectorId: "openai-codex",
      workspaceId,
      model: "gpt-5.3-codex",
      capabilities: "Build frontend features",
      budgetMonthlyUsd: 200,
    });

    const secondTaskId = db.saveTask({
      companyId,
      title: "Updated model task",
      description: "Use the new model for this run.",
      assigneeAgentId: agentId,
      workspaceId,
      priority: "high",
      status: "todo",
    });

    const secondRun = taskRunner.queueTaskRun(secondTaskId, "manual", "board");
    expect(secondRun.ok).toBe(true);
    expect(enqueueWorkerRun).toHaveBeenCalledTimes(2);
    expect(enqueueWorkerRun.mock.calls[1]?.[0]?.model).toBe("gpt-5.3-codex");

    db.close();
  });
});
