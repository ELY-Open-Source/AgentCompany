import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "../../src/main/database";
import { createBudgetEnforcementService } from "../../src/main/budget-enforcement-service";
import { createRunDispatch } from "../../src/main/orchestration/run-dispatch";
import { createTaskRunner } from "../../src/main/orchestration/task-runner";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => "basic_text",
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createHarness(db: AppDatabase) {
  const logger = createLogger();
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
    (filter) => db.core.runs.hasActiveRun(filter),
  );
  return { enqueueWorkerRun, taskRunner };
}

function createCompanyGraph(db: AppDatabase, profileDir: string) {
  db.core.connectors.updateConnectorHealth({
    id: "openai-codex",
    status: "ready",
    authState: "authenticated",
    version: "test",
    lastError: null,
  });
  const companyId = db.core.company.saveCompany({
    name: "Queued Recovery Co",
    description: "Recovers queued runs deterministically",
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
    name: "Engineer",
    role: "Engineer",
    title: "Engineer",
    status: "idle",
    reportsTo: null,
    connectorId: "openai-codex",
    workspaceId,
    model: "gpt-5.4",
    capabilities: "Runs queued recovery tasks",
    budgetMonthlyUsd: 100,
  });
  return { companyId, workspaceId, agentId };
}

function createQueuedTaskRun(db: AppDatabase, input: {
  companyId: string;
  workspaceId: string;
  agentId: string;
  title: string;
}) {
  const taskId = db.core.tasks.saveTask({
    companyId: input.companyId,
    title: input.title,
    description: "Queued before worker startup recovery.",
    assigneeAgentId: input.agentId,
    workspaceId: input.workspaceId,
    priority: "high",
    status: "todo",
  });
  const run = db.core.runs.createTaskRun({
    companyId: input.companyId,
    taskId,
    agentId: input.agentId,
    workspaceId: input.workspaceId,
    connectorId: "openai-codex",
  });
  if (!run) throw new Error("Expected queued run to be created.");
  return { taskId, runId: run.id };
}

describe("queued run recovery", () => {
  it("dispatches the first queued run and releases same-agent queued siblings", async () => {
    const profileDir = await createTempDir("agentcompany-queued-recovery-");
    const db = new AppDatabase(profileDir);
    db.init();
    const { companyId, workspaceId, agentId } = createCompanyGraph(db, profileDir);
    const first = createQueuedTaskRun(db, { companyId, workspaceId, agentId, title: "First queued task" });
    const second = createQueuedTaskRun(db, { companyId, workspaceId, agentId, title: "Second queued task" });
    const { enqueueWorkerRun, taskRunner } = createHarness(db);

    taskRunner.resumeQueuedRuns();

    expect(enqueueWorkerRun).toHaveBeenCalledOnce();
    expect(enqueueWorkerRun.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      runId: first.runId,
      taskId: first.taskId,
      agentId,
      trigger: "recovery",
    }));
    expect(db.core.runs.getRun(second.runId).status).toBe("cancelled");
    expect(db.core.entity.getTask(second.taskId).status).toBe("todo");
    db.close();
  });

  it("releases queued runs when recovery is blocked by connector readiness", async () => {
    const profileDir = await createTempDir("agentcompany-queued-connector-block-");
    const db = new AppDatabase(profileDir);
    db.init();
    const { companyId, workspaceId, agentId } = createCompanyGraph(db, profileDir);
    const queued = createQueuedTaskRun(db, { companyId, workspaceId, agentId, title: "Connector blocked task" });
    db.core.connectors.updateConnectorHealth({
      id: "openai-codex",
      status: "auth_required",
      authState: "missing",
      version: "test",
      lastError: "Login required",
    });
    const { enqueueWorkerRun, taskRunner } = createHarness(db);

    taskRunner.resumeQueuedRuns();

    expect(enqueueWorkerRun).not.toHaveBeenCalled();
    expect(db.core.runs.getRun(queued.runId).status).toBe("cancelled");
    expect(db.core.entity.getTask(queued.taskId).status).toBe("todo");
    db.close();
  });
});
