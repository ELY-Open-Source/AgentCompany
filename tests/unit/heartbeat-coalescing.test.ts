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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestCompany(db: AppDatabase): string {
  return db.saveCompany({
    name: "Test Company",
    description: "Heartbeat coalescing tests",
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

function createHeartbeatTask(
  db: AppDatabase,
  companyId: string,
  agentId: string,
  status: string,
  agentName = "Agent",
): string {
  return db.saveTask({
    companyId,
    title: `[Heartbeat] ${agentName} — Check for work`,
    description: `Automated heartbeat run for ${agentName}.`,
    assigneeAgentId: agentId,
    status,
    priority: "medium",
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Heartbeat task coalescing", () => {
  let tempDir: string;
  let db: AppDatabase;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-heartbeat-"));
    db = new AppDatabase(tempDir);
    db.init();
    createTestConnector(db);
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // findReusableHeartbeatTask
  // -------------------------------------------------------------------------

  describe("findReusableHeartbeatTask", () => {
    it("returns the most recent done heartbeat task for the agent", () => {
      const companyId = createTestCompany(db);
      const wsId = createTestWorkspace(db, companyId);
      const agentId = createTestAgent(db, companyId, wsId, "CEO");

      const taskId = createHeartbeatTask(db, companyId, agentId, "done", "CEO");

      const result = db.findReusableHeartbeatTask(agentId, companyId);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(taskId);
      expect(result!.status).toBe("done");
    });

    it("returns null when no heartbeat tasks exist for the agent", () => {
      const companyId = createTestCompany(db);
      const wsId = createTestWorkspace(db, companyId);
      const agentId = createTestAgent(db, companyId, wsId, "Worker");

      const result = db.findReusableHeartbeatTask(agentId, companyId);
      expect(result).toBeNull();
    });

    it("returns null when all heartbeat tasks are still in_progress", () => {
      const companyId = createTestCompany(db);
      const wsId = createTestWorkspace(db, companyId);
      const agentId = createTestAgent(db, companyId, wsId, "Worker");

      createHeartbeatTask(db, companyId, agentId, "in_progress", "Worker");

      const result = db.findReusableHeartbeatTask(agentId, companyId);
      expect(result).toBeNull();
    });

    it("returns the most recently updated heartbeat task when multiple done ones exist", () => {
      const companyId = createTestCompany(db);
      const wsId = createTestWorkspace(db, companyId);
      const agentId = createTestAgent(db, companyId, wsId, "CEO");

      // Create two done heartbeat tasks
      const _oldTaskId = createHeartbeatTask(db, companyId, agentId, "done", "CEO");
      const newTaskId = createHeartbeatTask(db, companyId, agentId, "done", "CEO");

      // Advance the newer one so its updated_at is more recent
      db.advanceTaskStatus(newTaskId, "in_review", "Testing");
      db.advanceTaskStatus(newTaskId, "done", "Testing done");

      const result = db.findReusableHeartbeatTask(agentId, companyId);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(newTaskId);
    });

    it("returns in_review task if no done tasks exist", () => {
      const companyId = createTestCompany(db);
      const wsId = createTestWorkspace(db, companyId);
      const agentId = createTestAgent(db, companyId, wsId, "Lead");

      const taskId = createHeartbeatTask(db, companyId, agentId, "in_review", "Lead");

      const result = db.findReusableHeartbeatTask(agentId, companyId);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(taskId);
    });

    it("does not return heartbeat tasks from other agents", () => {
      const companyId = createTestCompany(db);
      const wsId = createTestWorkspace(db, companyId);
      const agent1 = createTestAgent(db, companyId, wsId, "Agent1");
      const agent2 = createTestAgent(db, companyId, wsId, "Agent2");

      createHeartbeatTask(db, companyId, agent1, "done", "Agent1");

      const result = db.findReusableHeartbeatTask(agent2, companyId);
      expect(result).toBeNull();
    });

    it("does not return non-heartbeat tasks", () => {
      const companyId = createTestCompany(db);
      const wsId = createTestWorkspace(db, companyId);
      const agentId = createTestAgent(db, companyId, wsId, "Worker");

      // Create a regular done task (not a heartbeat)
      db.saveTask({
        companyId,
        title: "Regular completed task",
        description: "Not a heartbeat",
        assigneeAgentId: agentId,
        status: "done",
        priority: "medium",
      });

      const result = db.findReusableHeartbeatTask(agentId, companyId);
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // cleanupDuplicateHeartbeatTasks
  // -------------------------------------------------------------------------

  describe("cleanupDuplicateHeartbeatTasks", () => {
    it("cancels duplicate heartbeat tasks, keeping only the most recent per agent", () => {
      const companyId = createTestCompany(db);
      const wsId = createTestWorkspace(db, companyId);
      const agentId = createTestAgent(db, companyId, wsId, "CEO");

      // Create three done heartbeat tasks
      const _task1 = createHeartbeatTask(db, companyId, agentId, "done", "CEO");
      const _task2 = createHeartbeatTask(db, companyId, agentId, "done", "CEO");
      const task3 = createHeartbeatTask(db, companyId, agentId, "done", "CEO");

      // Touch task3 so it becomes the most recent
      db.advanceTaskStatus(task3, "in_review", "Touch");
      db.advanceTaskStatus(task3, "done", "Touch done");

      const cleaned = db.cleanupDuplicateHeartbeatTasks(companyId);
      expect(cleaned).toBe(2);

      // The most recent one should still be done
      const remaining = db.getTask(task3);
      expect(remaining.status).toBe("done");

      // The older ones should be cancelled
      const old1 = db.getTask(_task1);
      const old2 = db.getTask(_task2);
      expect(old1.status).toBe("cancelled");
      expect(old2.status).toBe("cancelled");
    });

    it("returns the count of cancelled tasks", () => {
      const companyId = createTestCompany(db);
      const wsId = createTestWorkspace(db, companyId);
      const agentId = createTestAgent(db, companyId, wsId, "Worker");

      createHeartbeatTask(db, companyId, agentId, "done", "Worker");
      createHeartbeatTask(db, companyId, agentId, "todo", "Worker");
      const newest = createHeartbeatTask(db, companyId, agentId, "done", "Worker");
      // Touch newest so it has the latest updated_at
      db.advanceTaskStatus(newest, "in_review", "Touch");
      db.advanceTaskStatus(newest, "done", "Touch done");

      const cleaned = db.cleanupDuplicateHeartbeatTasks(companyId);
      expect(cleaned).toBe(2);
    });

    it("does not cancel in_progress heartbeat tasks", () => {
      const companyId = createTestCompany(db);
      const wsId = createTestWorkspace(db, companyId);
      const agentId = createTestAgent(db, companyId, wsId, "Worker");

      const activeTask = createHeartbeatTask(db, companyId, agentId, "in_progress", "Worker");
      const doneTask = createHeartbeatTask(db, companyId, agentId, "done", "Worker");
      // Touch doneTask to make it more recent
      db.advanceTaskStatus(doneTask, "in_review", "Touch");
      db.advanceTaskStatus(doneTask, "done", "Touch done");

      const cleaned = db.cleanupDuplicateHeartbeatTasks(companyId);
      // Only 0 cancelled because in_progress cannot be cancelled and doneTask is the most recent
      expect(cleaned).toBe(0);

      // in_progress task should be untouched
      const active = db.getTask(activeTask);
      expect(active.status).toBe("in_progress");
    });

    it("keeps one heartbeat task per agent when company has multiple agents", () => {
      const companyId = createTestCompany(db);
      const wsId = createTestWorkspace(db, companyId);
      const agent1 = createTestAgent(db, companyId, wsId, "Agent1");
      const agent2 = createTestAgent(db, companyId, wsId, "Agent2");

      // Agent1: 3 heartbeat tasks
      createHeartbeatTask(db, companyId, agent1, "done", "Agent1");
      createHeartbeatTask(db, companyId, agent1, "done", "Agent1");
      const a1newest = createHeartbeatTask(db, companyId, agent1, "done", "Agent1");
      db.advanceTaskStatus(a1newest, "in_review", "Touch");
      db.advanceTaskStatus(a1newest, "done", "Touch done");

      // Agent2: 2 heartbeat tasks
      createHeartbeatTask(db, companyId, agent2, "done", "Agent2");
      const a2newest = createHeartbeatTask(db, companyId, agent2, "done", "Agent2");
      db.advanceTaskStatus(a2newest, "in_review", "Touch");
      db.advanceTaskStatus(a2newest, "done", "Touch done");

      const cleaned = db.cleanupDuplicateHeartbeatTasks(companyId);
      // 2 old from agent1 + 1 old from agent2 = 3
      expect(cleaned).toBe(3);

      // Most recent per agent should survive
      expect(db.getTask(a1newest).status).toBe("done");
      expect(db.getTask(a2newest).status).toBe("done");
    });

    it("returns 0 when no duplicate heartbeat tasks exist", () => {
      const companyId = createTestCompany(db);
      const wsId = createTestWorkspace(db, companyId);
      const agentId = createTestAgent(db, companyId, wsId, "Solo");

      // Only one heartbeat task
      createHeartbeatTask(db, companyId, agentId, "done", "Solo");

      const cleaned = db.cleanupDuplicateHeartbeatTasks(companyId);
      expect(cleaned).toBe(0);
    });
  });
});
