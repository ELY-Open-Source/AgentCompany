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
    name: "Wakeup Test Company",
    description: "Wakeup lifecycle tests",
    status: "active",
  });
}

function createTestConnector(db: AppDatabase): void {
  db.saveConnector({
    id: "codex_local",
    command: "codex",
    model: "gpt-5",
    envBindingText: "",
    notes: "Test connector",
  });
}

function createTestWorkspace(db: AppDatabase, companyId: string): string {
  return db.saveWorkspace({
    companyId,
    name: "Wakeup Workspace",
    localPath: "/tmp/wakeup-workspace",
    repoUrl: "https://github.com/example/wakeup",
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
    connectorId: "codex_local",
    workspaceId,
    model: null,
    capabilities: "Executes tasks",
    budgetMonthlyUsd: 100,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("wakeup lifecycle", () => {
  let tempDir: string;
  let db: AppDatabase;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-wakeup-"));
    db = new AppDatabase(tempDir);
    db.init();
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("enqueueWakeupRequest creates new queued wakeup", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentId = createTestAgent(db, companyId, workspaceId);

    db.enqueueWakeupRequest(companyId, agentId, "task.created", "New task assigned");

    const wakes = db.listWakeupRequests(companyId);
    expect(wakes.length).toBe(1);
    expect(wakes[0].agentId).toBe(agentId);
    expect(wakes[0].status).toBe("queued");
    expect(wakes[0].coalescedCount).toBe(0);

    const triggers = JSON.parse(wakes[0].triggerDetail!);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].trigger).toBe("task.created");
    expect(triggers[0].detail).toBe("New task assigned");
  });

  it("enqueueWakeupRequest coalesces into existing queued wakeup for same agent", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentId = createTestAgent(db, companyId, workspaceId);

    db.enqueueWakeupRequest(companyId, agentId, "task.created", "First task");
    db.enqueueWakeupRequest(companyId, agentId, "task.status_changed", "Second trigger");

    const wakes = db.listWakeupRequests(companyId);
    // D-07: Per-agent scope -- only one wakeup row should exist
    expect(wakes.length).toBe(1);
    expect(wakes[0].coalescedCount).toBe(1);

    const triggers = JSON.parse(wakes[0].triggerDetail!);
    expect(triggers).toHaveLength(2);
    expect(triggers[0].trigger).toBe("task.created");
    expect(triggers[1].trigger).toBe("task.status_changed");
  });

  it("listWakeupRequests returns rows filtered by companyId and optional agentId", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agent1Id = createTestAgent(db, companyId, workspaceId, "Agent1");
    const agent2Id = createTestAgent(db, companyId, workspaceId, "Agent2");

    db.enqueueWakeupRequest(companyId, agent1Id, "task.created", "Agent1 task");
    db.enqueueWakeupRequest(companyId, agent2Id, "task.created", "Agent2 task");

    // List all for company
    const allWakes = db.listWakeupRequests(companyId);
    expect(allWakes.length).toBe(2);

    // Filter by agentId
    const agent1Wakes = db.listWakeupRequests(companyId, { agentId: agent1Id });
    expect(agent1Wakes.length).toBe(1);
    expect(agent1Wakes[0].agentId).toBe(agent1Id);
  });
});
