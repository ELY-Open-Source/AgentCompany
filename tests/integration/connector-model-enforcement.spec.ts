import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "../../src/main/database";
import { createBudgetEnforcementService } from "../../src/main/budget-enforcement-service";
import { createRunDispatch } from "../../src/main/orchestration/run-dispatch";
import { createTaskRunner } from "../../src/main/orchestration/task-runner";
import { resolveModels } from "../../src/main/model-resolver";

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

function createOrchestrationHarness(db: AppDatabase) {
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
    createRunToken: () => "test-token",
    getApiPort: () => 3210,
    dispatchAutomation: vi.fn(),
    hasWorkerReady: () => true,
    enqueueWorkerRun: vi.fn(),
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
    (filter) => db.core.runs.hasActiveRun(filter),
  );

  return { deps, taskRunner };
}

describe("connector model enforcement", () => {
  it("auto picker excludes disabled connector models before run eligibility validation", async () => {
    const profileDir = await createTempDir("agentcompany-auto-model-pool-");
    const db = new AppDatabase(profileDir);
    db.init();

    db.core.connectors.updateConnectorHealth({
      id: "openai-codex",
      status: "ready",
      authState: "authenticated",
      version: "test",
      lastError: null,
    });
    db.core.connectors.updateConnectorHealth({
      id: "zai",
      status: "ready",
      authState: "authenticated",
      version: "test",
      lastError: null,
    });

    const companyId = db.core.company.saveCompany({
      name: "Auto Model Pool Co",
      description: "Routes around disabled connector model pools",
      status: "active",
    });
    const workspaceId = db.core.workspaces.saveWorkspace({
      companyId,
      name: "Primary",
      localPath: profileDir,
      repoUrl: "",
      repoRef: "",
      isPrimary: true,
    });
    const ceoId = db.core.agents.saveAgent({
      companyId,
      name: "CEO",
      role: "CEO",
      title: "Chief Executive Officer",
      status: "idle",
      reportsTo: null,
      connectorId: "zai",
      workspaceId,
      model: "glm-5.1",
      capabilities: "Lead the company",
      budgetMonthlyUsd: 250,
    });
    const architectId = db.core.agents.saveAgent({
      companyId,
      name: "Architect",
      role: "Architect",
      title: "Principal Architect",
      status: "idle",
      reportsTo: ceoId,
      connectorId: "openai-codex",
      workspaceId,
      model: "gpt-5.4",
      modelStrategy: "auto",
      capabilities: "Plan technical architecture",
      budgetMonthlyUsd: 250,
    });
    const taskId = db.core.tasks.saveTask({
      companyId,
      title: "Plan architecture",
      description: "Needs a hard reasoning model.",
      assigneeAgentId: architectId,
      workspaceId,
      priority: "high",
      status: "todo",
    });

    db.core.settings.setDisabledModels(
      companyId,
      "openai-codex",
      resolveModels("openai-codex").map((model) => ({ id: model.id, label: model.name })),
    );

    const { deps, taskRunner } = createOrchestrationHarness(db);
    const result = taskRunner.queueTaskRun(taskId, "manual", "board");

    expect(result.ok).toBe(true);
    expect(deps.enqueueWorkerRun).toHaveBeenCalledTimes(1);
    expect(deps.enqueueWorkerRun.mock.calls[0]?.[0]?.connectorId).toBe("zai");
    expect(deps.enqueueWorkerRun.mock.calls[0]?.[0]?.model).toMatch(/^glm-/);

    db.close();
  });

  it("blocks queueTaskRun when an agent keeps a disabled explicit model", async () => {
    const profileDir = await createTempDir("agentcompany-model-enforcement-");
    const db = new AppDatabase(profileDir);
    db.init();

    db.core.connectors.updateConnectorHealth({
      id: "openai-codex",
      status: "ready",
      authState: "authenticated",
      version: "test",
      lastError: null,
    });

    const companyId = db.core.company.saveCompany({
      name: "Runtime Enforcement Co",
      description: "Blocks runs when agent models are disabled",
      status: "active",
    });
    const workspaceId = db.core.workspaces.saveWorkspace({
      companyId,
      name: "Primary",
      localPath: profileDir,
      repoUrl: "",
      repoRef: "",
      isPrimary: true,
    });
    const agentId = db.core.agents.saveAgent({
      companyId,
      name: "CEO",
      role: "CEO",
      title: "Chief Executive Officer",
      status: "idle",
      reportsTo: null,
      connectorId: "openai-codex",
      workspaceId,
      model: "gpt-5.4",
      capabilities: "Lead the company",
      budgetMonthlyUsd: 250,
    });
    const taskId = db.core.tasks.saveTask({
      companyId,
      title: "Run with invalid model",
      description: "This task should be blocked because the agent model is disabled.",
      assigneeAgentId: agentId,
      workspaceId,
      priority: "high",
      status: "todo",
    });

    db.core.settings.setDisabledModels(companyId, "openai-codex", [{ id: "gpt-5.4", label: "gpt-5.4" }]);

    const { taskRunner } = createOrchestrationHarness(db);
    const result = taskRunner.queueTaskRun(taskId, "manual", "board");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected queueTaskRun to reject the disabled model.");
    }
    expect(result.error.code).toBe("CONNECTOR_MODEL_NOT_ALLOWED");
    expect(db.projection.snapshot.listSnapshot().runs).toHaveLength(0);

    db.close();
  });

  it("fails recovered queued runs when the persisted agent model becomes invalid", async () => {
    const profileDir = await createTempDir("agentcompany-model-recovery-");
    const db = new AppDatabase(profileDir);
    db.init();

    db.core.connectors.updateConnectorHealth({
      id: "openai-codex",
      status: "ready",
      authState: "authenticated",
      version: "test",
      lastError: null,
    });

    const companyId = db.core.company.saveCompany({
      name: "Recovered Run Co",
      description: "Rejects invalid queued runs during recovery",
      status: "active",
    });
    const workspaceId = db.core.workspaces.saveWorkspace({
      companyId,
      name: "Primary",
      localPath: profileDir,
      repoUrl: "",
      repoRef: "",
      isPrimary: true,
    });
    const agentId = db.core.agents.saveAgent({
      companyId,
      name: "CEO",
      role: "CEO",
      title: "Chief Executive Officer",
      status: "idle",
      reportsTo: null,
      connectorId: "openai-codex",
      workspaceId,
      model: "gpt-5.4",
      capabilities: "Lead the company",
      budgetMonthlyUsd: 250,
    });
    const taskId = db.core.tasks.saveTask({
      companyId,
      title: "Recover queued run",
      description: "This queued run should fail on recovery because the model is disabled.",
      assigneeAgentId: agentId,
      workspaceId,
      priority: "high",
      status: "todo",
    });

    const run = db.core.runs.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });
    const checkoutSuccess = db.core.tasks.checkoutTask(taskId, run.id);
    expect(checkoutSuccess).toBe(true);

    db.core.settings.setDisabledModels(companyId, "openai-codex", [{ id: "gpt-5.4", label: "gpt-5.4" }]);

    const { taskRunner } = createOrchestrationHarness(db);
    taskRunner.resumeQueuedRuns();

    const recoveredRun = db.projection.snapshot.listSnapshot().runs.find((entry) => entry.id === run.id);
    expect(recoveredRun?.status).toBe("failed");
    expect(recoveredRun?.errorMessage).toContain("Connector model is disabled or invalid");

    db.close();
  });
});
