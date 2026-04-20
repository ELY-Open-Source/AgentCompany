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
    name: "Edge Case Company",
    description: "Concurrent checkout edge case tests (D-05.1)",
    status: "active",
  });
}

function createTestConnector(db: AppDatabase): void {
  db.saveConnector({
    id: "gemini-cli",
    model: "gemini-pro",
    envBindingText: "",
    notes: "Test connector for concurrent checkout",
  });
}

function createTestWorkspace(db: AppDatabase, companyId: string): string {
  return db.saveWorkspace({
    companyId,
    name: "Test Workspace",
    localPath: "/tmp/concurrent-test",
    repoUrl: "https://github.com/example/concurrent",
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
    connectorId: "gemini-cli",
    workspaceId,
    model: null,
    capabilities: "Executes tasks",
    budgetMonthlyUsd: 100,
  });
}

function createTestTask(db: AppDatabase, companyId: string, workspaceId: string): string {
  return db.tasks.saveTask({
    companyId,
    title: "Concurrent Test Task",
    description: "A task for testing concurrent checkout edge cases",
    assigneeAgentId: null,
    workspaceId,
    priority: "medium",
    status: "todo",
  });
}

// ---------------------------------------------------------------------------
// Tests — Edge Case: Concurrent Task Checkout (D-05.1)
// ---------------------------------------------------------------------------

describe("Edge Case: Concurrent Task Checkout (D-05.1)", () => {
  let tempDir: string;
  let db: AppDatabase;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-concurrent-"));
    db = new AppDatabase(tempDir);
    db.init();
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("exactly one agent wins when two attempt simultaneous checkout", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentA = createTestAgent(db, companyId, workspaceId, "Agent-A");
    const agentB = createTestAgent(db, companyId, workspaceId, "Agent-B");
    const taskId = createTestTask(db, companyId, workspaceId);

    const { id: runIdA } = db.createRun({
      companyId,
      taskId,
      agentId: agentA,
      workspaceId,
      connectorId: "gemini-cli",
    });
    const { id: runIdB } = db.createRun({
      companyId,
      taskId,
      agentId: agentB,
      workspaceId,
      connectorId: "gemini-cli",
    });

    // Agent-A claims first
    const resultA = db.tasks.checkoutTask(taskId, runIdA);
    expect(resultA).toBe(true);

    // Agent-B tries to claim the same task
    const resultB = db.tasks.checkoutTask(taskId, runIdB);
    expect(resultB).toBe(false);

    // Task status must be in_progress (set by first successful checkout)
    const task = db.entityCrud.getTask(taskId);
    expect(task.status).toBe("in_progress");
  });

  it("losing agent can checkout a different task", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentA = createTestAgent(db, companyId, workspaceId, "Agent-A");
    const agentB = createTestAgent(db, companyId, workspaceId, "Agent-B");
    const taskId1 = createTestTask(db, companyId, workspaceId);

    const { id: runIdA } = db.createRun({
      companyId,
      taskId: taskId1,
      agentId: agentA,
      workspaceId,
      connectorId: "gemini-cli",
    });
    const { id: runIdB1 } = db.createRun({
      companyId,
      taskId: taskId1,
      agentId: agentB,
      workspaceId,
      connectorId: "gemini-cli",
    });

    // Agent-A wins first task
    expect(db.tasks.checkoutTask(taskId1, runIdA)).toBe(true);
    // Agent-B loses
    expect(db.tasks.checkoutTask(taskId1, runIdB1)).toBe(false);

    // Agent-B can still checkout a DIFFERENT task
    const taskId2 = createTestTask(db, companyId, workspaceId);
    const { id: runIdB2 } = db.createRun({
      companyId,
      taskId: taskId2,
      agentId: agentB,
      workspaceId,
      connectorId: "gemini-cli",
    });
    const resultB2 = db.tasks.checkoutTask(taskId2, runIdB2);
    expect(resultB2).toBe(true);

    // Verify second task is now in_progress
    const task2 = db.entityCrud.getTask(taskId2);
    expect(task2.status).toBe("in_progress");
  });

  it("checkout of in_progress task is rejected", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentA = createTestAgent(db, companyId, workspaceId, "Agent-A");
    const agentB = createTestAgent(db, companyId, workspaceId, "Agent-B");
    const taskId = createTestTask(db, companyId, workspaceId);

    // Agent-A checks out successfully
    const { id: runIdA } = db.createRun({
      companyId,
      taskId,
      agentId: agentA,
      workspaceId,
      connectorId: "gemini-cli",
    });
    expect(db.tasks.checkoutTask(taskId, runIdA)).toBe(true);

    // Task is now in_progress. A new run from Agent-B tries to checkout
    const { id: runIdB } = db.createRun({
      companyId,
      taskId,
      agentId: agentB,
      workspaceId,
      connectorId: "gemini-cli",
    });
    const result = db.tasks.checkoutTask(taskId, runIdB);
    expect(result).toBe(false);

    // Confirm status is still in_progress
    expect(db.entityCrud.getTask(taskId).status).toBe("in_progress");
  });

  it("after lock release, CAS guard still checks task status", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentA = createTestAgent(db, companyId, workspaceId, "Agent-A");
    const agentB = createTestAgent(db, companyId, workspaceId, "Agent-B");
    const taskId = createTestTask(db, companyId, workspaceId);

    // Agent-A checks out task
    const { id: runIdA } = db.createRun({
      companyId,
      taskId,
      agentId: agentA,
      workspaceId,
      connectorId: "gemini-cli",
    });
    expect(db.tasks.checkoutTask(taskId, runIdA)).toBe(true);

    // Release the lock (sets checkout_run_id = NULL)
    db.tasks.releaseTaskLock(taskId, runIdA);

    // Verify lock fields are cleared
    const row = (db as unknown as RawDb).db
      .prepare("SELECT checkout_run_id, execution_locked_at FROM tasks WHERE id = ?")
      .get(taskId) as { checkout_run_id: string | null; execution_locked_at: string | null };
    expect(row.checkout_run_id).toBeNull();
    expect(row.execution_locked_at).toBeNull();

    // Task is still in_progress though, so a new checkout fails
    // (CAS checks status IN ('todo', 'backlog'))
    const { id: runIdB } = db.createRun({
      companyId,
      taskId,
      agentId: agentB,
      workspaceId,
      connectorId: "gemini-cli",
    });
    const result = db.tasks.checkoutTask(taskId, runIdB);
    expect(result).toBe(false);
  });

  it("stale lock recovery frees locks older than timeout", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentA = createTestAgent(db, companyId, workspaceId, "Agent-A");
    const taskId = createTestTask(db, companyId, workspaceId);

    const { id: runIdA } = db.createRun({
      companyId,
      taskId,
      agentId: agentA,
      workspaceId,
      connectorId: "gemini-cli",
    });
    expect(db.tasks.checkoutTask(taskId, runIdA)).toBe(true);

    // Backdate execution_locked_at to well past the stale timeout
    (db as unknown as RawDb).db
      .prepare("UPDATE tasks SET execution_locked_at = '2020-01-01T00:00:00Z' WHERE id = ?")
      .run(taskId);

    const recovered = db.recoverStaleLocks();
    expect(recovered.length).toBe(1);
    expect(recovered[0].taskId).toBe(taskId);
    expect(recovered[0].companyId).toBe(companyId);

    // Checkout fields should be cleared
    const row = (db as unknown as RawDb).db
      .prepare("SELECT checkout_run_id, execution_locked_at FROM tasks WHERE id = ?")
      .get(taskId) as { checkout_run_id: string | null; execution_locked_at: string | null };
    expect(row.checkout_run_id).toBeNull();
    expect(row.execution_locked_at).toBeNull();
  });

  it("after stale recovery, different agent can checkout the recovered task", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentA = createTestAgent(db, companyId, workspaceId, "Agent-A");
    const agentB = createTestAgent(db, companyId, workspaceId, "Agent-B");
    const taskId = createTestTask(db, companyId, workspaceId);

    // Agent-A checks out, then lock goes stale
    const { id: runIdA } = db.createRun({
      companyId,
      taskId,
      agentId: agentA,
      workspaceId,
      connectorId: "gemini-cli",
    });
    expect(db.tasks.checkoutTask(taskId, runIdA)).toBe(true);

    // Backdate to make stale
    (db as unknown as RawDb).db
      .prepare("UPDATE tasks SET execution_locked_at = '2020-01-01T00:00:00Z' WHERE id = ?")
      .run(taskId);

    // Recover stale locks (sets status back to "todo")
    const recovered = db.recoverStaleLocks();
    expect(recovered.length).toBe(1);

    // Verify task is back to "todo"
    expect(db.entityCrud.getTask(taskId).status).toBe("todo");

    // Agent-B can now checkout the recovered task
    const { id: runIdB } = db.createRun({
      companyId,
      taskId,
      agentId: agentB,
      workspaceId,
      connectorId: "gemini-cli",
    });
    const result = db.tasks.checkoutTask(taskId, runIdB);
    expect(result).toBe(true);
    expect(db.entityCrud.getTask(taskId).status).toBe("in_progress");
  });

  it("STALE_LOCK_TIMEOUT_MS matches expected 15 minute value", () => {
    expect(STALE_LOCK_TIMEOUT_MS).toBe(15 * 60 * 1000);
  });
});
