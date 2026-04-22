import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
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

import { AppDatabase, STALE_LOCK_TIMEOUT_MS } from "../../src/main/database";

type RawDb = {
  db: {
    prepare: (sql: string) => {
      run: (...args: unknown[]) => void;
      get: (...args: unknown[]) => unknown;
    };
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestCompany(db: AppDatabase): string {
  return db.company.saveCompany({
    name: "Test Company",
    description: "Atomic checkout tests",
    status: "active",
  });
}

function createTestConnector(db: AppDatabase): void {
  db.connectorsCrud.saveConnector({
    id: "openai-codex",
    model: "gpt-5",
    envBindingText: "",
    notes: "Test connector",
  });
}

function createTestWorkspace(db: AppDatabase, companyId: string): string {
  return db.workspacesMod.saveWorkspace({
    companyId,
    name: "Test Workspace",
    localPath: "/tmp/test-workspace",
    repoUrl: "https://github.com/example/test",
    repoRef: "main",
    isPrimary: true,
  });
}

function createTestAgent(db: AppDatabase, companyId: string, workspaceId: string, name = "Agent"): string {
  return db.agents.saveAgent({
    companyId,
    name,
    role: "IC",
    title: name,
    status: "active",
    reportsTo: null,
    connectorId: "openai-codex",
    workspaceId,
    model: null,
    capabilities: "Executes tasks",
    budgetMonthlyUsd: 100,
  });
}

function createTestTask(db: AppDatabase, companyId: string, agentId: string | null, workspaceId: string): string {
  return db.tasks.saveTask({
    companyId,
    title: "Test Task",
    description: "A test task for checkout",
    assigneeAgentId: agentId,
    workspaceId,
    priority: "medium",
    status: "todo",
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CAS checkout", () => {
  let tempDir: string;
  let db: AppDatabase;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-checkout-"));
    db = new AppDatabase(tempDir);
    db.init();
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("CAS checkout succeeds for first claimer", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentId = createTestAgent(db, companyId, workspaceId);
    const taskId = createTestTask(db, companyId, null, workspaceId);

    const { id: runId } = db.runs.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });

    const result = db.tasks.checkoutTask(taskId, runId);
    expect(result).toBe(true);

    const task = db.entityCrud.getTask(taskId);
    expect(task.status).toBe("in_progress");
  });

  it("createRun does not claim a task before checkout", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentId = createTestAgent(db, companyId, workspaceId);
    const taskId = createTestTask(db, companyId, null, workspaceId);

    db.runs.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });

    const task = db.entityCrud.getTask(taskId);
    expect(task.activeRunId).toBeNull();
    expect(task.status).toBe("todo");
  });

  it("checkout rejects a missing run without mutating task state", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const taskId = createTestTask(db, companyId, null, workspaceId);
    const missingRunId = randomUUID();

    expect(() => db.tasks.checkoutTask(taskId, missingRunId)).toThrow(/Run not found/);

    const task = db.entityCrud.getTask(taskId);
    expect(task.activeRunId).toBeNull();
    expect(task.status).toBe("todo");
    const lease = (db as unknown as RawDb).db
      .prepare("SELECT run_id FROM task_leases WHERE task_id = ?")
      .get(taskId);
    expect(lease).toBeUndefined();
  });

  it("createTaskRun atomically creates the run and claims the task lease", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentId = createTestAgent(db, companyId, workspaceId);
    const taskId = createTestTask(db, companyId, null, workspaceId);

    const run = db.runs.createTaskRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });

    expect(run).not.toBeNull();
    const task = db.entityCrud.getTask(taskId);
    expect(task.status).toBe("in_progress");
    expect(task.activeRunId).toBe(run?.id);
    const lease = (db as unknown as RawDb).db
      .prepare("SELECT run_id FROM task_leases WHERE task_id = ?")
      .get(taskId) as { run_id: string } | undefined;
    expect(lease?.run_id).toBe(run?.id);
  });

  it("createTaskRun rolls back the run row when checkout loses the race", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentId = createTestAgent(db, companyId, workspaceId);
    const taskId = createTestTask(db, companyId, null, workspaceId);

    const firstRun = db.runs.createTaskRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });
    expect(firstRun).not.toBeNull();

    const losingRunId = randomUUID();
    const secondRun = db.runs.createTaskRun({
      id: losingRunId,
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });

    expect(secondRun).toBeNull();
    const stored = (db as unknown as RawDb).db
      .prepare("SELECT id FROM runs WHERE id = ?")
      .get(losingRunId);
    expect(stored).toBeUndefined();
  });

  it("CAS checkout fails for second claimer", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentId = createTestAgent(db, companyId, workspaceId);
    const taskId = createTestTask(db, companyId, null, workspaceId);

    const { id: runId1 } = db.runs.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });
    const { id: runId2 } = db.runs.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });

    expect(db.tasks.checkoutTask(taskId, runId1)).toBe(true);
    expect(db.tasks.checkoutTask(taskId, runId2)).toBe(false);
  });

  it("CAS checkout rejects already-in-progress tasks", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentId = createTestAgent(db, companyId, workspaceId);
    const taskId = createTestTask(db, companyId, null, workspaceId);

    // Manually set task to in_progress
    (db as unknown as RawDb).db.prepare("UPDATE tasks SET status = 'in_progress' WHERE id = ?").run(taskId);

    const { id: runId } = db.runs.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });

    expect(db.tasks.checkoutTask(taskId, runId)).toBe(false);
  });

  it("lock release in finishRun clears checkout fields", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentId = createTestAgent(db, companyId, workspaceId);
    const taskId = createTestTask(db, companyId, null, workspaceId);

    const { id: runId } = db.runs.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });

    db.tasks.checkoutTask(taskId, runId);
    db.runs.markRunStatus(runId, "running", "");
    db.runs.finishRun({
      runId,
      status: "succeeded",
      summary: "Done",
      errorMessage: null,
      exitCode: 0,
      signal: null,
      model: null,
      unattributedCost: false,
    });

    const row = (db as unknown as RawDb).db
      .prepare("SELECT checkout_run_id, execution_locked_at FROM tasks WHERE id = ?")
      .get(taskId) as { checkout_run_id: string | null; execution_locked_at: string | null };

    expect(row.checkout_run_id).toBeNull();
    expect(row.execution_locked_at).toBeNull();
  });

  it("lock release in cancelRunForDeletion clears checkout fields", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentId = createTestAgent(db, companyId, workspaceId);
    const taskId = createTestTask(db, companyId, null, workspaceId);

    const { id: runId } = db.runs.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });

    db.tasks.checkoutTask(taskId, runId);
    db.runs.markRunStatus(runId, "running", "");

    // Deleting the agent triggers cancelRunForDeletion for active runs
    db.agents.deleteAgent(agentId, companyId);

    const row = (db as unknown as RawDb).db
      .prepare("SELECT checkout_run_id, execution_locked_at FROM tasks WHERE id = ?")
      .get(taskId) as { checkout_run_id: string | null; execution_locked_at: string | null };

    expect(row.checkout_run_id).toBeNull();
    expect(row.execution_locked_at).toBeNull();
  });

  it("stale lock recovery resets tasks older than 15 minutes", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentId = createTestAgent(db, companyId, workspaceId);
    const taskId = createTestTask(db, companyId, null, workspaceId);

    const { id: runId } = db.runs.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });

    db.tasks.checkoutTask(taskId, runId);

    // Backdate execution_locked_at to 20 minutes ago
    const backdated = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    (db as unknown as RawDb).db
      .prepare("UPDATE tasks SET execution_locked_at = ? WHERE id = ?")
      .run(backdated, taskId);

    const recovered = db.recoverStaleLocks();

    expect(recovered.length).toBe(1);
    expect(recovered[0].taskId).toBe(taskId);
    expect(recovered[0].companyId).toBe(companyId);

    const task = db.entityCrud.getTask(taskId);
    expect(task.status).toBe("todo");

    const row = (db as unknown as RawDb).db
      .prepare("SELECT checkout_run_id, execution_locked_at FROM tasks WHERE id = ?")
      .get(taskId) as { checkout_run_id: string | null; execution_locked_at: string | null };

    expect(row.checkout_run_id).toBeNull();
    expect(row.execution_locked_at).toBeNull();
  });

  it("stale lock recovery ignores tasks within 15 minute window", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentId = createTestAgent(db, companyId, workspaceId);
    const taskId = createTestTask(db, companyId, null, workspaceId);

    const { id: runId } = db.runs.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });

    db.tasks.checkoutTask(taskId, runId);

    const recovered = db.recoverStaleLocks();
    expect(recovered.length).toBe(0);

    const task = db.entityCrud.getTask(taskId);
    expect(task.status).toBe("in_progress");
  });

  it("STALE_LOCK_TIMEOUT_MS is 15 minutes", () => {
    expect(STALE_LOCK_TIMEOUT_MS).toBe(15 * 60 * 1000);
  });

  it("failed dispatch (run never started) rolls task back to 'todo' so heartbeat can retry", () => {
    // Regression: workspace-lock contention calls finishRun('failed') on a
    // run that never reached 'running'. The old code cleared checkout_run_id
    // but left task.status='in_progress' — the next checkoutTask pass then
    // refused (WHERE status IN ('todo','backlog')), and the scheduler
    // deadlocked while logging "lost checkout race" every 15 seconds.
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentId = createTestAgent(db, companyId, workspaceId);
    const taskId = createTestTask(db, companyId, null, workspaceId);

    const { id: runId } = db.runs.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });
    db.tasks.checkoutTask(taskId, runId);
    expect(db.entityCrud.getTask(taskId).status).toBe("in_progress");

    // Never call markRunStatus('running', ...) — this simulates the
    // "workspace already locked" bail-out inside dispatchRunToWorker.
    db.runs.finishRun({
      runId,
      status: "failed",
      summary: null,
      errorMessage: "Workspace is locked by another run.",
      exitCode: null,
      signal: null,
      model: null,
      unattributedCost: true,
    });

    expect(db.entityCrud.getTask(taskId).status).toBe("todo");

    // And the next CAS checkout must succeed — proving the heartbeat
    // retry path is unblocked.
    const { id: retryRunId } = db.runs.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });
    expect(db.tasks.checkoutTask(taskId, retryRunId)).toBe(true);
  });

  it("cancelled run that never started also rolls task back to 'todo'", () => {
    // Workspace-contention bail-out in dispatchRunToWorker marks the run as
    // 'cancelled' (not 'failed'), so the Dashboard "Needs attention" banner
    // stays quiet. The rollback path must handle cancelled too, or the task
    // would stick in 'in_progress' just like the original 'failed' bug.
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentId = createTestAgent(db, companyId, workspaceId);
    const taskId = createTestTask(db, companyId, null, workspaceId);

    const { id: runId } = db.runs.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });
    db.tasks.checkoutTask(taskId, runId);
    db.runs.finishRun({
      runId,
      status: "cancelled",
      summary: null,
      errorMessage: "Workspace in use by another run; will retry.",
      exitCode: null,
      signal: null,
      model: null,
      unattributedCost: true,
    });

    expect(db.entityCrud.getTask(taskId).status).toBe("todo");
  });

  it("failed run that did start stays 'in_progress' (human retry path)", () => {
    // Counterpart to the regression above: a run that actually transitioned
    // to 'running' and then failed mid-flight is the user's problem to
    // resolve through the recovery UI — we must not silently reset its
    // task to 'todo' and lose the partial work / error context.
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentId = createTestAgent(db, companyId, workspaceId);
    const taskId = createTestTask(db, companyId, null, workspaceId);

    const { id: runId } = db.runs.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });
    db.tasks.checkoutTask(taskId, runId);
    db.runs.markRunStatus(runId, "running", "");
    db.runs.finishRun({
      runId,
      status: "failed",
      summary: null,
      errorMessage: "Worker crashed",
      exitCode: 1,
      signal: null,
      model: null,
      unattributedCost: false,
    });

    expect(db.entityCrud.getTask(taskId).status).toBe("in_progress");
  });

  it("advanceTaskStatus('in_review') rejects a CEO self-review that has no reviewer", () => {
    // Regression guard for the CEO dead-letter case: a task whose
    // assignee is a top-level agent (reports_to IS NULL) and that is
    // not flagged for user review has no reachable reviewer. Previous
    // versions silently resurrected these tasks at every DB init; the
    // root fix rejects the transition at source so callers either
    // escalate to the human or leave the task in a reclaimable state.
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const ceoId = createTestAgent(db, companyId, workspaceId, "CEO");
    const taskId = createTestTask(db, companyId, ceoId, workspaceId);

    expect(() => db.tasks.advanceTaskStatus(taskId, "in_review")).toThrow(/no reviewer/);
    // Task status must remain unchanged after the rejected transition.
    expect(db.entityCrud.getTask(taskId).status).toBe("todo");
  });

  it("advanceTaskStatus('in_review') accepts a CEO assignee flagged requires_user_review=1", () => {
    // The same task becomes legitimate when the human is the reviewer.
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const ceoId = createTestAgent(db, companyId, workspaceId, "CEO");
    const taskId = createTestTask(db, companyId, ceoId, workspaceId);
    db.tasks.setTaskRequiresUserReview(taskId, true);

    db.tasks.advanceTaskStatus(taskId, "in_review");
    expect(db.entityCrud.getTask(taskId).status).toBe("in_review");
  });

  it("interruptStaleRuns surfaces shutdown-era running runs without startup task rewrites", () => {
    // `interruptStaleRuns` is the ONLY mutation the startup path may
    // perform: any run at 'running' on boot means a crash, so the run
    // flips to 'interrupted' and the task surfaces as 'blocked' for
    // operator attention. No other reconciliation runs at init; the
    // task-status machine (see guardInReviewHasReviewer) and the
    // runtime `finishRun` guards are now responsible for every other
    // data-repair concern.
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentId = createTestAgent(db, companyId, workspaceId);
    const taskId = createTestTask(db, companyId, null, workspaceId);

    const { id: liveRunId } = db.runs.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });
    db.tasks.checkoutTask(taskId, liveRunId);
    db.runs.markRunStatus(liveRunId, "running", "");

    db.close();
    db = new AppDatabase(tempDir);
    db.init();

    expect(db.lastInterruptedCount).toBe(1);
    expect(db.entityCrud.getTask(taskId).status).toBe("blocked");
  });
});
