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

/**
 * B2 Phase 1 step 2/5 — unit coverage for the new phase + lease helpers.
 *
 * These tests exercise the shadow surface directly against a real
 * SQLite database: v50 has run, the `tasks.phase` column and
 * `task_leases` table exist, and the new helpers write and read them
 * without going through any production code path. The goal is to pin
 * the state machine semantics (CAS rejection on wrong `from`, lease
 * replacement on staleness, release idempotency) before step 3/5 wires
 * the helpers into `checkoutTask` / `finishRun`.
 */

function createTestCompany(db: AppDatabase): string {
  return db.saveCompany({
    name: "Phase Helper Company",
    description: "B2 phase + lease unit tests",
    status: "active",
  });
}

function createTestConnector(db: AppDatabase): void {
  db.saveConnector({
    id: "openai-codex",
    model: "gpt-5",
    envBindingText: "",
    notes: "Test connector",
  });
}

function createTestWorkspace(db: AppDatabase, companyId: string): string {
  return db.saveWorkspace({
    companyId,
    name: "Phase Workspace",
    localPath: "/tmp/phase-workspace",
    repoUrl: "https://github.com/example/phase",
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
    capabilities: "Run task helpers",
    budgetMonthlyUsd: 100,
  });
}

function createTestTask(
  db: AppDatabase,
  companyId: string,
  agentId: string,
  workspaceId: string,
): string {
  return db.tasks.saveTask({
    companyId,
    title: "Phase helper task",
    description: "dual-write seed",
    assigneeAgentId: agentId,
    workspaceId,
    priority: "medium",
    status: "todo",
  });
}

function createTestRun(
  db: AppDatabase,
  companyId: string,
  taskId: string,
  agentId: string,
  workspaceId: string,
): string {
  const { id } = db.createRun({
    companyId,
    taskId,
    agentId,
    workspaceId,
    connectorId: "openai-codex",
  });
  return id;
}

describe("tasks-phase helpers", () => {
  let tempDir: string;
  let db: AppDatabase;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-phase-"));
    db = new AppDatabase(tempDir);
    db.init();
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("advanceTaskPhase", () => {
    it("backfill leaves every existing task with a phase matching its status", () => {
      const companyId = createTestCompany(db);
      createTestConnector(db);
      const workspaceId = createTestWorkspace(db, companyId);
      const agentId = createTestAgent(db, companyId, workspaceId);
      const taskId = createTestTask(db, companyId, agentId, workspaceId);
      // `saveTask` ran with the v50 migration already applied, so the
      // row must carry a phase value immediately.
      const row = (db as unknown as {
        db: { prepare: (sql: string) => { get: (...args: unknown[]) => unknown } };
      }).db
        .prepare("SELECT phase FROM tasks WHERE id = ?")
        .get(taskId) as { phase: string } | undefined;
      expect(row?.phase).toBe("todo");
    });

    it("CAS transition succeeds when the current phase matches `from`", () => {
      const companyId = createTestCompany(db);
      createTestConnector(db);
      const workspaceId = createTestWorkspace(db, companyId);
      const agentId = createTestAgent(db, companyId, workspaceId);
      const taskId = createTestTask(db, companyId, agentId, workspaceId);

      const ok = db.tasks.advanceTaskPhase(taskId, "todo", "in_progress");
      expect(ok).toBe(true);
      const after = db.tasks.getTaskLease(taskId);
      expect(after).toBeNull(); // phase transitions do not auto-create leases
      const row = (db as unknown as {
        db: { prepare: (sql: string) => { get: (...args: unknown[]) => unknown } };
      }).db
        .prepare("SELECT phase FROM tasks WHERE id = ?")
        .get(taskId) as { phase: string } | undefined;
      expect(row?.phase).toBe("in_progress");
    });

    it("CAS transition refuses when the current phase does not match `from`", () => {
      const companyId = createTestCompany(db);
      createTestConnector(db);
      const workspaceId = createTestWorkspace(db, companyId);
      const agentId = createTestAgent(db, companyId, workspaceId);
      const taskId = createTestTask(db, companyId, agentId, workspaceId);

      // Row is at phase=todo; pretending it was in_progress must fail.
      const ok = db.tasks.advanceTaskPhase(taskId, "in_progress", "completed");
      expect(ok).toBe(false);
    });

    it("CHECK constraint rejects a write to an unknown phase value", () => {
      const companyId = createTestCompany(db);
      createTestConnector(db);
      const workspaceId = createTestWorkspace(db, companyId);
      const agentId = createTestAgent(db, companyId, workspaceId);
      const taskId = createTestTask(db, companyId, agentId, workspaceId);

      // Using the raw DB to bypass the TypeScript enum — the CHECK
      // constraint installed in v50 must still reject the write.
      expect(() => {
        (db as unknown as {
          db: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } };
        }).db
          .prepare("UPDATE tasks SET phase = ? WHERE id = ?")
          .run("bogus", taskId);
      }).toThrow();
    });
  });

  describe("acquireTaskLease", () => {
    it("acquires a lease when none exists and returns the row", () => {
      const companyId = createTestCompany(db);
      createTestConnector(db);
      const workspaceId = createTestWorkspace(db, companyId);
      const agentId = createTestAgent(db, companyId, workspaceId);
      const taskId = createTestTask(db, companyId, agentId, workspaceId);
      const runId = createTestRun(db, companyId, taskId, agentId, workspaceId);

      const lease = db.tasks.acquireTaskLease({
        taskId,
        runId,
        ttlMs: 60_000,
        checkoutRunId: runId,
      });
      expect(lease).not.toBeNull();
      expect(lease?.taskId).toBe(taskId);
      expect(lease?.runId).toBe(runId);
      expect(lease?.checkoutRunId).toBe(runId);
    });

    it("refreshing the lease for the same run succeeds and moves expires_at forward", () => {
      const companyId = createTestCompany(db);
      createTestConnector(db);
      const workspaceId = createTestWorkspace(db, companyId);
      const agentId = createTestAgent(db, companyId, workspaceId);
      const taskId = createTestTask(db, companyId, agentId, workspaceId);
      const runId = createTestRun(db, companyId, taskId, agentId, workspaceId);

      const first = db.tasks.acquireTaskLease({ taskId, runId, ttlMs: 10_000 });
      expect(first).not.toBeNull();
      const renewed = db.tasks.acquireTaskLease({ taskId, runId, ttlMs: 60_000 });
      expect(renewed).not.toBeNull();
      expect(Date.parse(renewed!.expiresAt)).toBeGreaterThanOrEqual(Date.parse(first!.expiresAt));
    });

    it("refuses to hand the lease to a different live run", () => {
      const companyId = createTestCompany(db);
      createTestConnector(db);
      const workspaceId = createTestWorkspace(db, companyId);
      const agentId = createTestAgent(db, companyId, workspaceId);
      const taskId = createTestTask(db, companyId, agentId, workspaceId);
      const runA = createTestRun(db, companyId, taskId, agentId, workspaceId);
      const runB = createTestRun(db, companyId, taskId, agentId, workspaceId);

      const ownedByA = db.tasks.acquireTaskLease({ taskId, runId: runA, ttlMs: 60_000 });
      expect(ownedByA).not.toBeNull();
      const blocked = db.tasks.acquireTaskLease({ taskId, runId: runB, ttlMs: 60_000 });
      expect(blocked).toBeNull();
      const current = db.tasks.getTaskLease(taskId);
      expect(current?.runId).toBe(runA);
    });

    it("replaces a stale lease when the previous window has expired", () => {
      const companyId = createTestCompany(db);
      createTestConnector(db);
      const workspaceId = createTestWorkspace(db, companyId);
      const agentId = createTestAgent(db, companyId, workspaceId);
      const taskId = createTestTask(db, companyId, agentId, workspaceId);
      const runA = createTestRun(db, companyId, taskId, agentId, workspaceId);
      const runB = createTestRun(db, companyId, taskId, agentId, workspaceId);

      const ownedByA = db.tasks.acquireTaskLease({ taskId, runId: runA, ttlMs: 60_000 });
      expect(ownedByA).not.toBeNull();
      // Force the lease into the past by rewriting expires_at directly.
      const pastIso = new Date(Date.now() - 1_000).toISOString();
      (db as unknown as {
        db: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } };
      }).db
        .prepare("UPDATE task_leases SET expires_at = ? WHERE task_id = ?")
        .run(pastIso, taskId);

      const takenByB = db.tasks.acquireTaskLease({ taskId, runId: runB, ttlMs: 60_000 });
      expect(takenByB).not.toBeNull();
      expect(takenByB?.runId).toBe(runB);
    });

    it("throws when ttlMs is not a positive finite number", () => {
      const companyId = createTestCompany(db);
      createTestConnector(db);
      const workspaceId = createTestWorkspace(db, companyId);
      const agentId = createTestAgent(db, companyId, workspaceId);
      const taskId = createTestTask(db, companyId, agentId, workspaceId);
      const runId = createTestRun(db, companyId, taskId, agentId, workspaceId);

      expect(() =>
        db.tasks.acquireTaskLease({ taskId, runId, ttlMs: 0 }),
      ).toThrow(/positive finite number/);
      expect(() =>
        db.tasks.acquireTaskLease({ taskId, runId, ttlMs: Number.NaN }),
      ).toThrow(/positive finite number/);
    });
  });

  describe("releaseTaskLease", () => {
    it("releases the lease when the runId matches", () => {
      const companyId = createTestCompany(db);
      createTestConnector(db);
      const workspaceId = createTestWorkspace(db, companyId);
      const agentId = createTestAgent(db, companyId, workspaceId);
      const taskId = createTestTask(db, companyId, agentId, workspaceId);
      const runId = createTestRun(db, companyId, taskId, agentId, workspaceId);

      db.tasks.acquireTaskLease({ taskId, runId, ttlMs: 60_000 });
      const released = db.tasks.releaseTaskLease(taskId, runId);
      expect(released).toBe(true);
      expect(db.tasks.getTaskLease(taskId)).toBeNull();
    });

    it("does nothing when a different runId asks to release", () => {
      const companyId = createTestCompany(db);
      createTestConnector(db);
      const workspaceId = createTestWorkspace(db, companyId);
      const agentId = createTestAgent(db, companyId, workspaceId);
      const taskId = createTestTask(db, companyId, agentId, workspaceId);
      const runA = createTestRun(db, companyId, taskId, agentId, workspaceId);
      const runB = createTestRun(db, companyId, taskId, agentId, workspaceId);

      db.tasks.acquireTaskLease({ taskId, runId: runA, ttlMs: 60_000 });
      const released = db.tasks.releaseTaskLease(taskId, runB);
      expect(released).toBe(false);
      const current = db.tasks.getTaskLease(taskId);
      expect(current?.runId).toBe(runA);
    });
  });
});
