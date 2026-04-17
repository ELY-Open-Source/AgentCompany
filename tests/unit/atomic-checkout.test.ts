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
      costUsd: 0,
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
});
