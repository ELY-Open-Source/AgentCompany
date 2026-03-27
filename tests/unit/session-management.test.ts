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
import { getConnectorDefinition } from "../../src/main/connectors";
import type { ConnectorId } from "@shared/types";

// ---------------------------------------------------------------------------
// Helpers — create a minimal company + agent + task scaffold
// ---------------------------------------------------------------------------
function scaffold(db: AppDatabase) {
  const companyId = db.saveCompany({
    name: "Session Test Co",
    description: "Testing session management",
    status: "active",
  });
  const workspaceId = db.saveWorkspace({
    companyId,
    name: "Primary",
    localPath: "/tmp/session-test",
    repoUrl: "",
    repoRef: "",
    isPrimary: true,
  });
  const agentId = db.saveAgent({
    companyId,
    name: "Worker Agent",
    role: "developer",
    title: "Developer",
    status: "active",
    reportsTo: null,
    connectorId: "claude_local",
    workspaceId,
    model: "claude-4-opus",
    capabilities: "Writes code",
    budgetMonthlyUsd: 100,
  });
  const goalId = db.saveGoal({
    companyId,
    title: "Ship feature",
    description: "Build session management",
    ownerAgentId: agentId,
    status: "active",
  });
  const projectId = db.saveProject({
    companyId,
    goalId,
    name: "Session Project",
    description: "Session management work",
    leadAgentId: agentId,
    status: "in_progress",
    targetDate: null,
  });
  const taskId = db.saveTask({
    companyId,
    projectId,
    goalId,
    title: "Implement session rotation",
    description: "Build the session rotation logic for task execution.",
    assigneeAgentId: agentId,
    workspaceId,
    priority: "high",
    status: "in_progress",
  });
  return { companyId, workspaceId, agentId, goalId, projectId, taskId };
}

// ===========================================================================
// task_sessions CRUD
// ===========================================================================
describe("task_sessions CRUD", () => {
  let tempDir: string;
  let db: AppDatabase;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-session-"));
    db = new AppDatabase(tempDir);
    db.init();
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("getActiveTaskSession returns null when active_session_id is null", () => {
    const { taskId } = scaffold(db);
    const session = db.getActiveTaskSession(taskId);
    expect(session).toBeNull();
  });

  it("getActiveTaskSession returns TaskSessionRecord when valid session exists", () => {
    const { taskId, companyId, agentId } = scaffold(db);
    const sessionId = db.createNewSession({
      taskId,
      companyId,
      agentId,
      adapterType: "claude_local",
      sessionParamsJson: JSON.stringify({ sessionId: "abc123" }),
      sessionDisplayId: "claude-abc123",
    });

    const session = db.getActiveTaskSession(taskId);
    expect(session).not.toBeNull();
    expect(session!.id).toBe(sessionId);
    expect(session!.taskId).toBe(taskId);
    expect(session!.companyId).toBe(companyId);
    expect(session!.agentId).toBe(agentId);
    expect(session!.adapterType).toBe("claude_local");
    expect(session!.sessionParamsJson).toBe(JSON.stringify({ sessionId: "abc123" }));
    expect(session!.sessionDisplayId).toBe("claude-abc123");
    expect(session!.runCount).toBe(0);
    expect(session!.totalInputTokens).toBe(0);
    expect(session!.totalOutputTokens).toBe(0);
    expect(session!.rotatedAt).toBeNull();
    expect(session!.rotationReason).toBeNull();
    expect(session!.handoffMarkdown).toBeNull();
  });

  it("incrementSessionUsage atomically updates counters", () => {
    const { taskId, companyId, agentId } = scaffold(db);
    const sessionId = db.createNewSession({
      taskId,
      companyId,
      agentId,
      adapterType: "claude_local",
      sessionParamsJson: null,
      sessionDisplayId: null,
    });

    db.incrementSessionUsage(sessionId, 1000, 500, "run-001");

    const session = db.getActiveTaskSession(taskId);
    expect(session!.runCount).toBe(1);
    expect(session!.totalInputTokens).toBe(1000);
    expect(session!.totalOutputTokens).toBe(500);
    expect(session!.lastRunId).toBe("run-001");

    // Second increment accumulates
    db.incrementSessionUsage(sessionId, 2000, 800, "run-002");
    const session2 = db.getActiveTaskSession(taskId);
    expect(session2!.runCount).toBe(2);
    expect(session2!.totalInputTokens).toBe(3000);
    expect(session2!.totalOutputTokens).toBe(1300);
    expect(session2!.lastRunId).toBe("run-002");
  });

  it("archiveSession sets rotated_at, rotation_reason, handoff_markdown", () => {
    const { taskId, companyId, agentId } = scaffold(db);
    const sessionId = db.createNewSession({
      taskId,
      companyId,
      agentId,
      adapterType: "claude_local",
      sessionParamsJson: null,
      sessionDisplayId: null,
    });

    db.archiveSession(sessionId, "max_runs", "# Handoff\nSession reached 20 runs.");

    const session = db.getActiveTaskSession(taskId);
    expect(session!.rotatedAt).toBeTruthy();
    expect(session!.rotationReason).toBe("max_runs");
    expect(session!.handoffMarkdown).toBe("# Handoff\nSession reached 20 runs.");
  });

  it("createNewSession creates session and updates tasks.active_session_id", () => {
    const { taskId, companyId, agentId } = scaffold(db);

    const sessionId = db.createNewSession({
      taskId,
      companyId,
      agentId,
      adapterType: "gemini_local",
      sessionParamsJson: JSON.stringify({ key: "val" }),
      sessionDisplayId: "gemini-session-1",
    });

    expect(typeof sessionId).toBe("string");
    expect(sessionId.length).toBeGreaterThan(0);

    // active_session_id should point to new session
    const session = db.getActiveTaskSession(taskId);
    expect(session).not.toBeNull();
    expect(session!.id).toBe(sessionId);
    expect(session!.adapterType).toBe("gemini_local");
  });

  it("getRecentRunsForTask returns last N runs ordered by finished_at DESC", () => {
    const { taskId, companyId, agentId, workspaceId } = scaffold(db);

    // Create some runs
    const run1 = db.createRun({ companyId, taskId, agentId, workspaceId, connectorId: "claude_local" });
    db.finishRun({
      runId: run1.id,
      status: "completed",
      summary: "First run done",
      errorMessage: null,
      exitCode: 0,
      signal: null,
      model: "claude-4-opus",
      sessionDisplayId: null,
      costUsd: 0.01,
      unattributedCost: false,
    });

    const run2 = db.createRun({ companyId, taskId, agentId, workspaceId, connectorId: "claude_local" });
    db.finishRun({
      runId: run2.id,
      status: "failed",
      summary: "Second run failed",
      errorMessage: "Timeout",
      exitCode: 1,
      signal: null,
      model: "claude-4-opus",
      sessionDisplayId: null,
      costUsd: 0.02,
      unattributedCost: false,
    });

    const runs = db.getRecentRunsForTask(taskId, 5);
    expect(runs.length).toBe(2);
    // Most recent first
    expect(runs[0].id).toBe(run2.id);
    expect(runs[0].status).toBe("failed");
    expect(runs[0].errorMessage).toBe("Timeout");
    expect(runs[1].id).toBe(run1.id);
    expect(runs[1].status).toBe("completed");
  });
});

// ===========================================================================
// adapter exemption
// ===========================================================================
describe("adapter exemption", () => {
  it("claude_local connector has nativeContextManagement: true", () => {
    const def = getConnectorDefinition("claude_local" as ConnectorId);
    expect(def.module.nativeContextManagement).toBe(true);
  });

  it("codex_local connector has nativeContextManagement: true", () => {
    const def = getConnectorDefinition("codex_local" as ConnectorId);
    expect(def.module.nativeContextManagement).toBe(true);
  });

  it("gemini_local connector has nativeContextManagement: false", () => {
    const def = getConnectorDefinition("gemini_local" as ConnectorId);
    expect(def.module.nativeContextManagement).toBe(false);
  });
});
