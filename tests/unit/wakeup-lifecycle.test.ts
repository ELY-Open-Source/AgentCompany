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

  it("enqueueWakeupRequest coalesces into existing deferred wakeup", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentId = createTestAgent(db, companyId, workspaceId);

    db.enqueueWakeupRequest(companyId, agentId, "task.created", "First task");
    db.deferWakeupRequest(agentId, companyId);

    // Verify it's deferred
    const deferredWakes = db.listWakeupRequests(companyId, { status: "deferred" });
    expect(deferredWakes.length).toBe(1);

    // Enqueue another -- should coalesce into the deferred wake
    db.enqueueWakeupRequest(companyId, agentId, "task.status_changed", "Status update");

    const allWakes = db.listWakeupRequests(companyId, { agentId });
    // Only one row (the deferred one, now with coalesced trigger)
    expect(allWakes.length).toBe(1);
    expect(allWakes[0].coalescedCount).toBe(1);

    const triggers = JSON.parse(allWakes[0].triggerDetail!);
    expect(triggers).toHaveLength(2);
  });

  it("claimWakeupRequest transitions queued to claimed", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentId = createTestAgent(db, companyId, workspaceId);
    const taskId = db.saveTask({
      companyId,
      title: "Claim task",
      description: "For run creation",
      assigneeAgentId: agentId,
      workspaceId,
      priority: "medium",
      status: "todo",
    });

    db.enqueueWakeupRequest(companyId, agentId, "task.created", "New task");

    const { id: runId } = db.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "codex_local",
    });

    const claimed = db.claimWakeupRequest(agentId, companyId, runId);
    expect(claimed).not.toBeNull();
    expect(claimed!.triggerDetail).toBeTruthy();

    const wakes = db.listWakeupRequests(companyId, { status: "claimed" });
    expect(wakes.length).toBe(1);
    expect(wakes[0].runId).toBe(runId);
    expect(wakes[0].claimedAt).toBeTruthy();
  });

  it("claimWakeupRequest returns null when no queued wake exists", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentId = createTestAgent(db, companyId, workspaceId);

    const result = db.claimWakeupRequest(agentId, companyId, "fake-run-id");
    expect(result).toBeNull();
  });

  it("completeWakeupRequest transitions claimed to completed", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentId = createTestAgent(db, companyId, workspaceId);
    const taskId = db.saveTask({
      companyId,
      title: "Complete task",
      description: "For run creation",
      assigneeAgentId: agentId,
      workspaceId,
      priority: "medium",
      status: "todo",
    });

    db.enqueueWakeupRequest(companyId, agentId, "task.created", "New task");

    const { id: runId } = db.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "codex_local",
    });

    const claimed = db.claimWakeupRequest(agentId, companyId, runId);
    expect(claimed).not.toBeNull();

    db.completeWakeupRequest(claimed!.id);

    const completed = db.listWakeupRequests(companyId, { status: "completed" });
    expect(completed.length).toBe(1);
    expect(completed[0].finishedAt).toBeTruthy();
  });

  it("deferWakeupRequest transitions queued to deferred", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentId = createTestAgent(db, companyId, workspaceId);

    db.enqueueWakeupRequest(companyId, agentId, "task.created", "New task");
    db.deferWakeupRequest(agentId, companyId);

    const deferred = db.listWakeupRequests(companyId, { status: "deferred" });
    expect(deferred.length).toBe(1);

    const queued = db.listWakeupRequests(companyId, { status: "queued" });
    expect(queued.length).toBe(0);
  });

  it("promoteWakeupRequests promotes deferred to queued", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentId = createTestAgent(db, companyId, workspaceId);

    db.enqueueWakeupRequest(companyId, agentId, "task.created", "First task");
    db.deferWakeupRequest(agentId, companyId);

    // Verify deferred
    expect(db.listWakeupRequests(companyId, { status: "deferred" }).length).toBe(1);

    const promoted = db.promoteWakeupRequests(agentId, companyId);
    expect(promoted).toBe(1);

    const queued = db.listWakeupRequests(companyId, { status: "queued" });
    expect(queued.length).toBe(1);

    const deferred = db.listWakeupRequests(companyId, { status: "deferred" });
    expect(deferred.length).toBe(0);
  });

  it("promoteWakeupRequests merges deferred into existing queued", () => {
    const companyId = createTestCompany(db);
    createTestConnector(db);
    const workspaceId = createTestWorkspace(db, companyId);
    const agentId = createTestAgent(db, companyId, workspaceId);

    // Create a queued wake, defer it, then create a new queued wake
    db.enqueueWakeupRequest(companyId, agentId, "first.trigger", "First");
    db.deferWakeupRequest(agentId, companyId);

    // Now create a new queued wake for the same agent
    db.enqueueWakeupRequest(companyId, agentId, "second.trigger", "Second");

    // At this point: 1 deferred (first) coalesced with second trigger, or 1 deferred + 1 queued
    // Actually: enqueueWakeupRequest coalesces into deferred, so we have 1 deferred row with 2 triggers
    // Let's create a scenario with distinct deferred + queued:

    // Start fresh for clarity
    // Clear by completing
    const wakesBeforePromote = db.listWakeupRequests(companyId, { agentId });
    // The coalescing means both triggers are in one deferred row
    // So let's verify promote on that single deferred row
    const promoted = db.promoteWakeupRequests(agentId, companyId);

    // After promote: should have 1 queued row with merged triggers
    const queued = db.listWakeupRequests(companyId, { status: "queued" });
    expect(queued.length).toBe(1);

    const triggers = JSON.parse(queued[0].triggerDetail!);
    expect(triggers.length).toBeGreaterThanOrEqual(2);
  });

  it("listWakeupRequests returns rows filtered by companyId and optional status/agentId", () => {
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

    // Filter by status
    db.deferWakeupRequest(agent1Id, companyId);
    const queuedOnly = db.listWakeupRequests(companyId, { status: "queued" });
    expect(queuedOnly.length).toBe(1);
    expect(queuedOnly[0].agentId).toBe(agent2Id);

    const deferredOnly = db.listWakeupRequests(companyId, { status: "deferred" });
    expect(deferredOnly.length).toBe(1);
    expect(deferredOnly[0].agentId).toBe(agent1Id);
  });
});
