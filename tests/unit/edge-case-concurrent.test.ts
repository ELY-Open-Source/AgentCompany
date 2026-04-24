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

type TaskLeaseRow = {
  task_id: string;
  run_id: string;
  expires_at: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestCompany(db: AppDatabase): string {
  return db.core.company.saveCompany({
    name: "Edge Case Company",
    description: "Concurrent checkout edge case tests (D-05.1)",
    status: "active",
  });
}

function createTestConnector(db: AppDatabase): void {
  db.core.connectors.saveConnector({
    id: "gemini-cli",
    model: "gemini-pro",
    envBindingText: "",
    notes: "Test connector for concurrent checkout",
  });
}

function createTestWorkspace(db: AppDatabase, companyId: string): string {
  return db.core.workspaces.saveWorkspace({
    companyId,
    name: "Test Workspace",
    localPath: "/tmp/concurrent-test",
    repoUrl: "https://github.com/example/concurrent",
    repoRef: "main",
    isPrimary: true,
  });
}

function createTestAgent(db: AppDatabase, companyId: string, workspaceId: string, name = "Agent"): string {
  return db.core.agents.saveAgent({
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
  return db.core.tasks.saveTask({
    companyId,
    title: "Concurrent Test Task",
    description: "A task for testing concurrent checkout edge cases",
    assigneeAgentId: null,
    workspaceId,
    priority: "medium",
    status: "todo",
  });
}

function getTaskLease(db: AppDatabase, taskId: string): TaskLeaseRow | null {
  return (
    ((db as unknown as RawDb).db
      .prepare("SELECT task_id, run_id, expires_at FROM task_leases WHERE task_id = ?")
      .get(taskId) as TaskLeaseRow | undefined) ?? null
  );
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

    const { id: runIdA } = db.core.runs.createRun({
      companyId,
      taskId,
      agentId: agentA,
      workspaceId,
      connectorId: "gemini-cli",
    });
    const { id: runIdB } = db.core.runs.createRun({
      companyId,
      taskId,
      agentId: agentB,
      workspaceId,
      connectorId: "gemini-cli",
    });

    // Agent-A claims first
    const resultA = db.core.tasks.checkoutTask(taskId, runIdA);
    expect(resultA).toBe(true);

    // Agent-B tries to claim the same task
    const resultB = db.core.tasks.checkoutTask(taskId, runIdB);
    expect(resultB).toBe(false);

    // Task status must be in_progress (set by first successful checkout)
    const task = db.core.entity.getTask(taskId);
    expect(task.status).toBe("in_progress");
  });

  it("losing agent can checkout a different task", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentA = createTestAgent(db, companyId, workspaceId, "Agent-A");
    const agentB = createTestAgent(db, companyId, workspaceId, "Agent-B");
    const taskId1 = createTestTask(db, companyId, workspaceId);

    const { id: runIdA } = db.core.runs.createRun({
      companyId,
      taskId: taskId1,
      agentId: agentA,
      workspaceId,
      connectorId: "gemini-cli",
    });
    const { id: runIdB1 } = db.core.runs.createRun({
      companyId,
      taskId: taskId1,
      agentId: agentB,
      workspaceId,
      connectorId: "gemini-cli",
    });

    // Agent-A wins first task
    expect(db.core.tasks.checkoutTask(taskId1, runIdA)).toBe(true);
    // Agent-B loses
    expect(db.core.tasks.checkoutTask(taskId1, runIdB1)).toBe(false);

    // Agent-B can still checkout a DIFFERENT task
    const taskId2 = createTestTask(db, companyId, workspaceId);
    const { id: runIdB2 } = db.core.runs.createRun({
      companyId,
      taskId: taskId2,
      agentId: agentB,
      workspaceId,
      connectorId: "gemini-cli",
    });
    const resultB2 = db.core.tasks.checkoutTask(taskId2, runIdB2);
    expect(resultB2).toBe(true);

    // Verify second task is now in_progress
    const task2 = db.core.entity.getTask(taskId2);
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
    const { id: runIdA } = db.core.runs.createRun({
      companyId,
      taskId,
      agentId: agentA,
      workspaceId,
      connectorId: "gemini-cli",
    });
    expect(db.core.tasks.checkoutTask(taskId, runIdA)).toBe(true);

    // Task is now in_progress. A new run from Agent-B tries to checkout
    const { id: runIdB } = db.core.runs.createRun({
      companyId,
      taskId,
      agentId: agentB,
      workspaceId,
      connectorId: "gemini-cli",
    });
    const result = db.core.tasks.checkoutTask(taskId, runIdB);
    expect(result).toBe(false);

    // Confirm status is still in_progress
    expect(db.core.entity.getTask(taskId).status).toBe("in_progress");
  });

  it("after lock release, CAS guard still checks task status", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentA = createTestAgent(db, companyId, workspaceId, "Agent-A");
    const agentB = createTestAgent(db, companyId, workspaceId, "Agent-B");
    const taskId = createTestTask(db, companyId, workspaceId);

    // Agent-A checks out task
    const { id: runIdA } = db.core.runs.createRun({
      companyId,
      taskId,
      agentId: agentA,
      workspaceId,
      connectorId: "gemini-cli",
    });
    expect(db.core.tasks.checkoutTask(taskId, runIdA)).toBe(true);

    // Release the lease while leaving the task lifecycle unchanged.
    db.core.tasks.releaseTaskLock(taskId, runIdA);

    expect(getTaskLease(db, taskId)).toBeNull();

    // Task is still in_progress though, so a new checkout fails
    // (CAS checks status IN ('todo', 'backlog'))
    const { id: runIdB } = db.core.runs.createRun({
      companyId,
      taskId,
      agentId: agentB,
      workspaceId,
      connectorId: "gemini-cli",
    });
    const result = db.core.tasks.checkoutTask(taskId, runIdB);
    expect(result).toBe(false);
  });

  it("stale lock recovery frees locks older than timeout", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentA = createTestAgent(db, companyId, workspaceId, "Agent-A");
    const taskId = createTestTask(db, companyId, workspaceId);

    const { id: runIdA } = db.core.runs.createRun({
      companyId,
      taskId,
      agentId: agentA,
      workspaceId,
      connectorId: "gemini-cli",
    });
    expect(db.core.tasks.checkoutTask(taskId, runIdA)).toBe(true);

    // Backdate the lease expiry past the stale timeout.
    (db as unknown as RawDb).db
      .prepare("UPDATE task_leases SET expires_at = '2020-01-01T00:00:00Z' WHERE task_id = ?")
      .run(taskId);

    const recovered = db.recoverStaleLocks();
    expect(recovered.length).toBe(1);
    expect(recovered[0].taskId).toBe(taskId);
    expect(recovered[0].companyId).toBe(companyId);

    expect(getTaskLease(db, taskId)).toBeNull();
  });

  it("after stale recovery, different agent can checkout the recovered task", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentA = createTestAgent(db, companyId, workspaceId, "Agent-A");
    const agentB = createTestAgent(db, companyId, workspaceId, "Agent-B");
    const taskId = createTestTask(db, companyId, workspaceId);

    // Agent-A checks out, then lock goes stale
    const { id: runIdA } = db.core.runs.createRun({
      companyId,
      taskId,
      agentId: agentA,
      workspaceId,
      connectorId: "gemini-cli",
    });
    expect(db.core.tasks.checkoutTask(taskId, runIdA)).toBe(true);

    // Backdate the lease to make it stale.
    (db as unknown as RawDb).db
      .prepare("UPDATE task_leases SET expires_at = '2020-01-01T00:00:00Z' WHERE task_id = ?")
      .run(taskId);

    // Recover stale locks (sets status back to "todo")
    const recovered = db.recoverStaleLocks();
    expect(recovered.length).toBe(1);

    // Verify task is back to "todo"
    expect(db.core.entity.getTask(taskId).status).toBe("todo");

    // Agent-B can now checkout the recovered task
    const { id: runIdB } = db.core.runs.createRun({
      companyId,
      taskId,
      agentId: agentB,
      workspaceId,
      connectorId: "gemini-cli",
    });
    const result = db.core.tasks.checkoutTask(taskId, runIdB);
    expect(result).toBe(true);
    expect(db.core.entity.getTask(taskId).status).toBe("in_progress");
  });

  it("STALE_LOCK_TIMEOUT_MS matches expected 15 minute value", () => {
    expect(STALE_LOCK_TIMEOUT_MS).toBe(15 * 60 * 1000);
  });
});
