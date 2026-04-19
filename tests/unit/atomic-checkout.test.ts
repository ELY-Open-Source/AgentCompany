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
  return db.saveCompany({
    name: "Test Company",
    description: "Atomic checkout tests",
    status: "active",
  });
}

function createTestConnector(db: AppDatabase): void {
  db.saveConnector({
    id: "openai-codex",
    command: "codex",
    model: "gpt-5",
    envBindingText: "",
    notes: "Test connector",
  });
}

function createTestWorkspace(db: AppDatabase, companyId: string): string {
  return db.saveWorkspace({
    companyId,
    name: "Test Workspace",
    localPath: "/tmp/test-workspace",
    repoUrl: "https://github.com/example/test",
    repoRef: "main",
    isPrimary: true,
  });
}

function createTestAgent(db: AppDatabase, companyId: string, workspaceId: string, name = "Agent"): string {
  return db.saveAgent({
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
  return db.saveTask({
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

    const { id: runId } = db.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });

    const result = db.checkoutTask(taskId, runId);
    expect(result).toBe(true);

    const task = db.getTask(taskId);
    expect(task.status).toBe("in_progress");
  });

  it("CAS checkout fails for second claimer", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentId = createTestAgent(db, companyId, workspaceId);
    const taskId = createTestTask(db, companyId, null, workspaceId);

    const { id: runId1 } = db.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });
    const { id: runId2 } = db.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });

    expect(db.checkoutTask(taskId, runId1)).toBe(true);
    expect(db.checkoutTask(taskId, runId2)).toBe(false);
  });

  it("CAS checkout rejects already-in-progress tasks", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentId = createTestAgent(db, companyId, workspaceId);
    const taskId = createTestTask(db, companyId, null, workspaceId);

    // Manually set task to in_progress
    (db as unknown as RawDb).db.prepare("UPDATE tasks SET status = 'in_progress' WHERE id = ?").run(taskId);

    const { id: runId } = db.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });

    expect(db.checkoutTask(taskId, runId)).toBe(false);
  });

  it("lock release in finishRun clears checkout fields", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentId = createTestAgent(db, companyId, workspaceId);
    const taskId = createTestTask(db, companyId, null, workspaceId);

    const { id: runId } = db.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });

    db.checkoutTask(taskId, runId);
    db.markRunStatus(runId, "running", "");
    db.finishRun({
      runId,
      status: "succeeded",
      summary: "Done",
      errorMessage: null,
      exitCode: 0,
      signal: null,
      model: null,
      sessionDisplayId: null,
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

    const { id: runId } = db.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });

    db.checkoutTask(taskId, runId);
    db.markRunStatus(runId, "running", "");

    // Deleting the agent triggers cancelRunForDeletion for active runs
    db.deleteAgent(agentId, companyId);

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

    const { id: runId } = db.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });

    db.checkoutTask(taskId, runId);

    // Backdate execution_locked_at to 20 minutes ago
    const backdated = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    (db as unknown as RawDb).db
      .prepare("UPDATE tasks SET execution_locked_at = ? WHERE id = ?")
      .run(backdated, taskId);

    const recovered = db.recoverStaleLocks();

    expect(recovered.length).toBe(1);
    expect(recovered[0].taskId).toBe(taskId);
    expect(recovered[0].companyId).toBe(companyId);

    const task = db.getTask(taskId);
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

    const { id: runId } = db.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });

    db.checkoutTask(taskId, runId);

    const recovered = db.recoverStaleLocks();
    expect(recovered.length).toBe(0);

    const task = db.getTask(taskId);
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

    const { id: runId } = db.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });
    db.checkoutTask(taskId, runId);
    expect(db.getTask(taskId).status).toBe("in_progress");

    // Never call markRunStatus('running', ...) — this simulates the
    // "workspace already locked" bail-out inside dispatchRunToWorker.
    db.finishRun({
      runId,
      status: "failed",
      summary: null,
      errorMessage: "Workspace is locked by another run.",
      exitCode: null,
      signal: null,
      model: null,
      sessionDisplayId: null,
      unattributedCost: true,
    });

    expect(db.getTask(taskId).status).toBe("todo");

    // And the next CAS checkout must succeed — proving the heartbeat
    // retry path is unblocked.
    const { id: retryRunId } = db.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });
    expect(db.checkoutTask(taskId, retryRunId)).toBe(true);
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

    const { id: runId } = db.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });
    db.checkoutTask(taskId, runId);
    db.finishRun({
      runId,
      status: "cancelled",
      summary: null,
      errorMessage: "Workspace in use by another run; will retry.",
      exitCode: null,
      signal: null,
      model: null,
      sessionDisplayId: null,
      unattributedCost: true,
    });

    expect(db.getTask(taskId).status).toBe("todo");
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

    const { id: runId } = db.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });
    db.checkoutTask(taskId, runId);
    db.markRunStatus(runId, "running", "");
    db.finishRun({
      runId,
      status: "failed",
      summary: null,
      errorMessage: "Worker crashed",
      exitCode: 1,
      signal: null,
      model: null,
      sessionDisplayId: null,
      unattributedCost: false,
    });

    expect(db.getTask(taskId).status).toBe("in_progress");
  });

  it("startup reconciliation unsticks tasks whose checkout_run_id points at a dead run", () => {
    // This is the shape observed in the wild: active_run_id cleared by
    // finishRun (unconditional clear), but checkout_run_id still carrying
    // a dead run id because the conditional clear's WHERE missed due to
    // a race. Task sits in 'in_progress' forever — heartbeat picks it
    // (activeRunId null), checkoutTask refuses (status != todo/backlog),
    // "lost checkout race" on loop. Reconciliation must fix it without
    // caring which reference column is null.
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentId = createTestAgent(db, companyId, workspaceId);
    const taskId = createTestTask(db, companyId, null, workspaceId);

    const { id: deadRunId } = db.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });
    db.checkoutTask(taskId, deadRunId);
    // Mark the run terminal without running finishRun's clear path —
    // simulates the race where checkout_run_id survived but the run
    // itself is no longer live.
    (db as unknown as RawDb).db
      .prepare("UPDATE runs SET status = 'cancelled' WHERE id = ?")
      .run(deadRunId);
    (db as unknown as RawDb).db
      .prepare("UPDATE tasks SET active_run_id = NULL WHERE id = ?")
      .run(taskId);

    // Pre-condition: task is stuck.
    const stuck = (db as unknown as RawDb).db
      .prepare("SELECT status, checkout_run_id as checkoutRunId, active_run_id as activeRunId FROM tasks WHERE id = ?")
      .get(taskId) as { status: string; checkoutRunId: string | null; activeRunId: string | null };
    expect(stuck.status).toBe("in_progress");
    expect(stuck.checkoutRunId).toBe(deadRunId);
    expect(stuck.activeRunId).toBeNull();

    // Re-initialise: reconciliation should run.
    db.close();
    db = new AppDatabase(tempDir);
    db.init();

    expect(db.lastOrphanResetCount).toBe(1);
    const reclaimed = db.getTask(taskId);
    expect(reclaimed.status).toBe("todo");

    // And a fresh checkout must succeed — proving the task is reclaimable.
    const { id: newRunId } = db.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });
    expect(db.checkoutTask(taskId, newRunId)).toBe(true);
  });

  it("startup reconciliation unsticks in_review tasks with no possible reviewer", () => {
    // Observed in production: a fresh `ai_ceo` company with only a CEO
    // self-assigned a large task and set status=in_review. The reviewer
    // would be the assignee's manager (walk up reports_to), but the CEO
    // has no manager. With `requires_user_review = 0` there is no human
    // fallback either. The heartbeat falls into a loop re-proposing
    // `approve_ceo_strategy` every cycle without ever hiring or moving
    // the task. Demoting to 'todo' breaks the loop.
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    // Top-level agent (CEO): reports_to stays NULL.
    const ceoId = createTestAgent(db, companyId, workspaceId, "CEO");
    const taskId = createTestTask(db, companyId, ceoId, workspaceId);
    // Manually wedge the task into the dead-letter shape.
    (db as unknown as RawDb).db
      .prepare("UPDATE tasks SET status = 'in_review', requires_user_review = 0 WHERE id = ?")
      .run(taskId);

    expect(db.getTask(taskId).status).toBe("in_review");

    // Re-init triggers reconciliation.
    db.close();
    db = new AppDatabase(tempDir);
    db.init();

    expect(db.lastUnreviewableResetCount).toBe(1);
    expect(db.getTask(taskId).status).toBe("todo");
  });

  it("in_review tasks requiring user review are left alone", () => {
    // Opposite guard: when requires_user_review = 1 the task is
    // intentionally parked waiting for a human — the reconciler must
    // not steal it.
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const ceoId = createTestAgent(db, companyId, workspaceId, "CEO");
    const taskId = createTestTask(db, companyId, ceoId, workspaceId);
    (db as unknown as RawDb).db
      .prepare("UPDATE tasks SET status = 'in_review', requires_user_review = 1 WHERE id = ?")
      .run(taskId);

    db.close();
    db = new AppDatabase(tempDir);
    db.init();

    expect(db.lastUnreviewableResetCount).toBe(0);
    expect(db.getTask(taskId).status).toBe("in_review");
  });

  it("reconciliation does not fire when interruptStaleRuns already handled a running task", () => {
    // Opposite guard: tasks whose run was `running` at shutdown are
    // handled earlier in init by `interruptStaleRuns` — it marks the
    // run 'interrupted' and sets the task to 'blocked' for human
    // review. By the time reconciliation runs, the task is no longer
    // 'in_progress', so the cleanup's WHERE clause skips it. The user
    // sees the task surfaced in the recovery UI, not silently reset.
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentId = createTestAgent(db, companyId, workspaceId);
    const taskId = createTestTask(db, companyId, null, workspaceId);

    const { id: liveRunId } = db.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });
    db.checkoutTask(taskId, liveRunId);
    db.markRunStatus(liveRunId, "running", "");

    db.close();
    db = new AppDatabase(tempDir);
    db.init();

    // Reconciliation counted 0 because interruptStaleRuns moved the
    // task to 'blocked' first. Both guards collaborate — neither
    // steals a task out from under an actively-working run.
    expect(db.lastOrphanResetCount).toBe(0);
    expect(db.getTask(taskId).status).toBe("blocked");
  });
});
