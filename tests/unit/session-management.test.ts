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
import { createSessionManagementService, DEFAULT_THRESHOLDS } from "../../src/main/session-management-service";
import type { ConnectorId, TaskSessionRecord } from "@shared/types";

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
    connectorId: "claude-pro",
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
      adapterType: "claude-pro",
      sessionParamsJson: JSON.stringify({ sessionId: "abc123" }),
      sessionDisplayId: "claude-abc123",
    });

    const session = db.getActiveTaskSession(taskId);
    expect(session).not.toBeNull();
    expect(session!.id).toBe(sessionId);
    expect(session!.taskId).toBe(taskId);
    expect(session!.companyId).toBe(companyId);
    expect(session!.agentId).toBe(agentId);
    expect(session!.adapterType).toBe("claude-pro");
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
      adapterType: "claude-pro",
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
      adapterType: "claude-pro",
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
      adapterType: "gemini-cli",
      sessionParamsJson: JSON.stringify({ key: "val" }),
      sessionDisplayId: "gemini-session-1",
    });

    expect(typeof sessionId).toBe("string");
    expect(sessionId.length).toBeGreaterThan(0);

    // active_session_id should point to new session
    const session = db.getActiveTaskSession(taskId);
    expect(session).not.toBeNull();
    expect(session!.id).toBe(sessionId);
    expect(session!.adapterType).toBe("gemini-cli");
  });

  it("getRecentRunsForTask returns last N runs ordered by finished_at DESC", () => {
    const { taskId, companyId, agentId, workspaceId } = scaffold(db);

    // Create some runs
    const run1 = db.createRun({ companyId, taskId, agentId, workspaceId, connectorId: "claude-pro" });
    db.finishRun({
      runId: run1.id,
      status: "succeeded",
      summary: "First run done",
      errorMessage: null,
      exitCode: 0,
      signal: null,
      model: "claude-4-opus",
      sessionDisplayId: null,
      costUsd: 0.01,
      unattributedCost: false,
    });

    const run2 = db.createRun({ companyId, taskId, agentId, workspaceId, connectorId: "claude-pro" });
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
    expect(runs[1].status).toBe("succeeded");
  });
});

// ===========================================================================
// connector definition lookup
// ===========================================================================
describe("connector definition lookup", () => {
  it("resolves claude-pro definition from the pi-mono catalog", () => {
    const def = getConnectorDefinition("claude-pro" as ConnectorId);
    expect(def.id).toBe("claude-pro");
    expect(def.provider).toBe("anthropic");
  });

  it("resolves openai-codex definition from the pi-mono catalog", () => {
    const def = getConnectorDefinition("openai-codex" as ConnectorId);
    expect(def.id).toBe("openai-codex");
    expect(def.provider).toBe("openai-codex");
  });

  it("resolves gemini-cli definition from the pi-mono catalog", () => {
    const def = getConnectorDefinition("gemini-cli" as ConnectorId);
    expect(def.id).toBe("gemini-cli");
    expect(def.provider).toBe("google-gemini-cli");
  });
});

// ===========================================================================
// Session management service tests
// ===========================================================================
describe("session management service", () => {
  let tempDir: string;
  let db: AppDatabase;
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-svc-"));
    db = new AppDatabase(tempDir);
    db.init();
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // rotation thresholds
  // -------------------------------------------------------------------------
  describe("rotation thresholds", () => {
    it("returns shouldRotate: false when below all thresholds", () => {
      const svc = createSessionManagementService({ db, logger: mockLogger });
      const session: TaskSessionRecord = {
        id: "sess-1",
        companyId: "co-1",
        taskId: "task-1",
        agentId: "agent-1",
        adapterType: "gemini-cli",
        sessionParamsJson: null,
        sessionDisplayId: null,
        lastRunId: null,
        lastError: null,
        runCount: 5,
        totalInputTokens: 10000,
        totalOutputTokens: 5000,
        rotatedAt: null,
        rotationReason: null,
        handoffMarkdown: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const result = svc.evaluateRotation(session, "gemini-cli");
      expect(result.shouldRotate).toBe(false);
      expect(result.reason).toBeNull();
    });

    it("returns shouldRotate: true with reason max_runs when run_count >= 20", () => {
      const svc = createSessionManagementService({ db, logger: mockLogger });
      const session: TaskSessionRecord = {
        id: "sess-1",
        companyId: "co-1",
        taskId: "task-1",
        agentId: "agent-1",
        adapterType: "gemini-cli",
        sessionParamsJson: null,
        sessionDisplayId: null,
        lastRunId: null,
        lastError: null,
        runCount: 20,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        rotatedAt: null,
        rotationReason: null,
        handoffMarkdown: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const result = svc.evaluateRotation(session, "gemini-cli");
      expect(result.shouldRotate).toBe(true);
      expect(result.reason).toBe("max_runs");
    });

    it("returns shouldRotate: true with reason max_tokens when total tokens >= 500000", () => {
      const svc = createSessionManagementService({ db, logger: mockLogger });
      const session: TaskSessionRecord = {
        id: "sess-1",
        companyId: "co-1",
        taskId: "task-1",
        agentId: "agent-1",
        adapterType: "gemini-cli",
        sessionParamsJson: null,
        sessionDisplayId: null,
        lastRunId: null,
        lastError: null,
        runCount: 3,
        totalInputTokens: 300000,
        totalOutputTokens: 200000,
        rotatedAt: null,
        rotationReason: null,
        handoffMarkdown: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const result = svc.evaluateRotation(session, "gemini-cli");
      expect(result.shouldRotate).toBe(true);
      expect(result.reason).toBe("max_tokens");
    });

    it("returns shouldRotate: true with reason max_age_hours when session created > 72h ago", () => {
      const svc = createSessionManagementService({ db, logger: mockLogger });
      const oldDate = new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString();
      const session: TaskSessionRecord = {
        id: "sess-1",
        companyId: "co-1",
        taskId: "task-1",
        agentId: "agent-1",
        adapterType: "gemini-cli",
        sessionParamsJson: null,
        sessionDisplayId: null,
        lastRunId: null,
        lastError: null,
        runCount: 1,
        totalInputTokens: 100,
        totalOutputTokens: 100,
        rotatedAt: null,
        rotationReason: null,
        handoffMarkdown: null,
        createdAt: oldDate,
        updatedAt: oldDate,
      };
      const result = svc.evaluateRotation(session, "gemini-cli");
      expect(result.shouldRotate).toBe(true);
      expect(result.reason).toBe("max_age_hours");
    });
  });

  // -------------------------------------------------------------------------
  // uniform rotation under pi-mono
  // -------------------------------------------------------------------------
  describe("uniform rotation under pi-mono", () => {
    it("returns shouldRotate: true for all connectors when thresholds exceeded (pi-mono has no native exemption)", () => {
      const svc = createSessionManagementService({ db, logger: mockLogger });
      const session: TaskSessionRecord = {
        id: "sess-1",
        companyId: "co-1",
        taskId: "task-1",
        agentId: "agent-1",
        adapterType: "claude-pro",
        sessionParamsJson: null,
        sessionDisplayId: null,
        lastRunId: null,
        lastError: null,
        runCount: 100, // Way over threshold
        totalInputTokens: 1000000,
        totalOutputTokens: 500000,
        rotatedAt: null,
        rotationReason: null,
        handoffMarkdown: null,
        createdAt: new Date(Date.now() - 200 * 60 * 60 * 1000).toISOString(), // Way old
        updatedAt: new Date().toISOString(),
      };
      const result = svc.evaluateRotation(session, "claude-pro");
      expect(result.shouldRotate).toBe(true);
      expect(result.reason).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // configurable thresholds (D-01)
  // -------------------------------------------------------------------------
  describe("configurable thresholds (D-01)", () => {
    it("evaluateRotation with custom thresholds override { maxRuns: 5 } triggers at 5 runs", () => {
      const svc = createSessionManagementService({ db, logger: mockLogger });
      const session: TaskSessionRecord = {
        id: "sess-1",
        companyId: "co-1",
        taskId: "task-1",
        agentId: "agent-1",
        adapterType: "gemini-cli",
        sessionParamsJson: null,
        sessionDisplayId: null,
        lastRunId: null,
        lastError: null,
        runCount: 5,
        totalInputTokens: 100,
        totalOutputTokens: 100,
        rotatedAt: null,
        rotationReason: null,
        handoffMarkdown: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const result = svc.evaluateRotation(session, "gemini-cli", { maxRuns: 5 });
      expect(result.shouldRotate).toBe(true);
      expect(result.reason).toBe("max_runs");
    });

    it("partial override { maxTokens: 100000 } uses override for tokens but defaults for runs and age", () => {
      const svc = createSessionManagementService({ db, logger: mockLogger });
      const session: TaskSessionRecord = {
        id: "sess-1",
        companyId: "co-1",
        taskId: "task-1",
        agentId: "agent-1",
        adapterType: "gemini-cli",
        sessionParamsJson: null,
        sessionDisplayId: null,
        lastRunId: null,
        lastError: null,
        runCount: 10, // Below default 20
        totalInputTokens: 60000,
        totalOutputTokens: 40000, // Total 100000 = meets override threshold
        rotatedAt: null,
        rotationReason: null,
        handoffMarkdown: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const result = svc.evaluateRotation(session, "gemini-cli", { maxTokens: 100000 });
      expect(result.shouldRotate).toBe(true);
      expect(result.reason).toBe("max_tokens");
    });

    it("omitting override uses DEFAULT_THRESHOLDS", () => {
      const svc = createSessionManagementService({ db, logger: mockLogger });
      const session: TaskSessionRecord = {
        id: "sess-1",
        companyId: "co-1",
        taskId: "task-1",
        agentId: "agent-1",
        adapterType: "gemini-cli",
        sessionParamsJson: null,
        sessionDisplayId: null,
        lastRunId: null,
        lastError: null,
        runCount: 19, // Just below default 20
        totalInputTokens: 200000,
        totalOutputTokens: 200000, // Total 400000, below default 500000
        rotatedAt: null,
        rotationReason: null,
        handoffMarkdown: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const result = svc.evaluateRotation(session, "gemini-cli");
      expect(result.shouldRotate).toBe(false);
      expect(result.reason).toBeNull();

      // Verify DEFAULT_THRESHOLDS values
      expect(DEFAULT_THRESHOLDS.maxRuns).toBe(20);
      expect(DEFAULT_THRESHOLDS.maxTokens).toBe(500_000);
      expect(DEFAULT_THRESHOLDS.maxAgeHours).toBe(72);
    });
  });

  // -------------------------------------------------------------------------
  // token accumulation
  // -------------------------------------------------------------------------
  describe("token accumulation", () => {
    it("accumulateTokenUsage calls db.incrementSessionUsage with correct args", () => {
      const { taskId, companyId, agentId } = scaffold(db);
      const sessionId = db.createNewSession({
        taskId,
        companyId,
        agentId,
        adapterType: "claude-pro",
        sessionParamsJson: null,
        sessionDisplayId: null,
      });
      const svc = createSessionManagementService({ db, logger: mockLogger });

      svc.accumulateTokenUsage(sessionId, 5000, 2000, "run-abc");

      const session = db.getActiveTaskSession(taskId);
      expect(session!.runCount).toBe(1);
      expect(session!.totalInputTokens).toBe(5000);
      expect(session!.totalOutputTokens).toBe(2000);
      expect(session!.lastRunId).toBe("run-abc");
    });
  });

  // -------------------------------------------------------------------------
  // handoff generation
  // -------------------------------------------------------------------------
  describe("handoff generation", () => {
    it("generateHandoff produces markdown with task title and run history", () => {
      const { taskId, companyId, agentId, workspaceId } = scaffold(db);
      const sessionId = db.createNewSession({
        taskId,
        companyId,
        agentId,
        adapterType: "gemini-cli",
        sessionParamsJson: null,
        sessionDisplayId: null,
      });

      // Create a completed run for history
      const run = db.createRun({ companyId, taskId, agentId, workspaceId, connectorId: "gemini-cli" as ConnectorId });
      db.finishRun({
        runId: run.id,
        status: "succeeded",
        summary: "Implemented initial logic",
        errorMessage: null,
        exitCode: 0,
        signal: null,
        model: "gemini-pro",
        sessionDisplayId: null,
        costUsd: 0.05,
        unattributedCost: false,
      });

      // Increment session usage to have stats
      db.incrementSessionUsage(sessionId, 10000, 5000, run.id);

      const session = db.getActiveTaskSession(taskId)!;
      const svc = createSessionManagementService({ db, logger: mockLogger });
      const handoff = svc.generateHandoff(taskId, session);

      expect(handoff).toContain("# Session Handoff");
      expect(handoff).toContain("Implement session rotation"); // task title
      expect(handoff).toContain("## Recent Run History");
      expect(handoff).toContain("succeeded");
      expect(handoff).toContain("15000 total tokens"); // 10000 + 5000
    });
  });

  // -------------------------------------------------------------------------
  // session rotation
  // -------------------------------------------------------------------------
  describe("session rotation", () => {
    it("rotateSession archives old session, creates new, copies session_params", () => {
      const { taskId, companyId, agentId } = scaffold(db);
      const oldSessionId = db.createNewSession({
        taskId,
        companyId,
        agentId,
        adapterType: "gemini-cli",
        sessionParamsJson: JSON.stringify({ resumeId: "old-abc" }),
        sessionDisplayId: "gemini-old",
      });

      // Add some usage
      db.incrementSessionUsage(oldSessionId, 300000, 200000, "run-10");

      const oldSession = db.getActiveTaskSession(taskId)!;
      const svc = createSessionManagementService({ db, logger: mockLogger });
      const newSessionId = svc.rotateSession(oldSession);

      expect(newSessionId).not.toBe(oldSessionId);

      // Old session should be archived
      const archivedRows = db.queryAll<{ rotatedAt: string | null; rotationReason: string | null; handoffMarkdown: string | null }>(
        "SELECT rotated_at as rotatedAt, rotation_reason as rotationReason, handoff_markdown as handoffMarkdown FROM task_sessions WHERE id = ?",
        oldSessionId
      );
      expect(archivedRows[0].rotatedAt).toBeTruthy();
      expect(archivedRows[0].rotationReason).toBe("threshold_exceeded");
      expect(archivedRows[0].handoffMarkdown).toContain("# Session Handoff");

      // New session should be active, with fresh counters and copied params
      const newSession = db.getActiveTaskSession(taskId)!;
      expect(newSession.id).toBe(newSessionId);
      expect(newSession.runCount).toBe(0);
      expect(newSession.totalInputTokens).toBe(0);
      expect(newSession.totalOutputTokens).toBe(0);
      expect(newSession.sessionParamsJson).toBe(JSON.stringify({ resumeId: "old-abc" }));
      expect(newSession.sessionDisplayId).toBe("gemini-old");
    });
  });

  // -------------------------------------------------------------------------
  // handoff context retrieval
  // -------------------------------------------------------------------------
  describe("handoff context retrieval", () => {
    it("getHandoffContext returns handoff_markdown from most recently rotated session", () => {
      const { taskId, companyId, agentId } = scaffold(db);
      const svc = createSessionManagementService({ db, logger: mockLogger });

      // Create and rotate a session
      const session1Id = db.createNewSession({
        taskId,
        companyId,
        agentId,
        adapterType: "gemini-cli",
        sessionParamsJson: null,
        sessionDisplayId: null,
      });
      db.incrementSessionUsage(session1Id, 100000, 50000, "run-1");
      const session1 = db.getActiveTaskSession(taskId)!;
      svc.rotateSession(session1);

      const handoff = svc.getHandoffContext(taskId);
      expect(handoff).not.toBeNull();
      expect(handoff).toContain("# Session Handoff");
    });

    it("getHandoffContext returns null when no rotated sessions exist", () => {
      const { taskId, companyId, agentId } = scaffold(db);
      db.createNewSession({
        taskId,
        companyId,
        agentId,
        adapterType: "gemini-cli",
        sessionParamsJson: null,
        sessionDisplayId: null,
      });
      const svc = createSessionManagementService({ db, logger: mockLogger });

      const handoff = svc.getHandoffContext(taskId);
      expect(handoff).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // usage delta (D-09)
  // -------------------------------------------------------------------------
  describe("usage delta", () => {
    it("getUsageDelta returns token difference between snapshot and current totals", () => {
      const { taskId, companyId, agentId } = scaffold(db);
      const sessionId = db.createNewSession({
        taskId,
        companyId,
        agentId,
        adapterType: "gemini-cli",
        sessionParamsJson: null,
        sessionDisplayId: null,
      });

      // Pre-populate some usage
      db.incrementSessionUsage(sessionId, 1000, 500, "run-1");

      const session = db.getActiveTaskSession(taskId)!;
      const svc = createSessionManagementService({ db, logger: mockLogger });

      // Snapshot current state
      const snapshot = svc.snapshotUsage(session);
      expect(snapshot.inputTokens).toBe(1000);
      expect(snapshot.outputTokens).toBe(500);

      // Accumulate more tokens
      svc.accumulateTokenUsage(sessionId, 3000, 1500, "run-2");

      // Delta should reflect new tokens only
      const delta = svc.getUsageDelta(sessionId, snapshot);
      expect(delta.inputTokensDelta).toBe(3000);
      expect(delta.outputTokensDelta).toBe(1500);
    });
  });
});

// ===========================================================================
// wiring integration
// ===========================================================================
describe("wiring integration", () => {
  // These tests verify the run-finished handler correctly calls session service methods.
  // Uses vi.fn() mocks to isolate the wiring logic from actual DB/service implementations.

  function createMockSessionService() {
    return {
      accumulateTokenUsage: vi.fn(),
      evaluateRotation: vi.fn().mockReturnValue({ shouldRotate: false, reason: null }),
      generateHandoff: vi.fn().mockReturnValue("# Handoff"),
      rotateSession: vi.fn().mockReturnValue("new-session-id"),
      getHandoffContext: vi.fn().mockReturnValue(null),
      snapshotUsage: vi.fn().mockReturnValue({ inputTokens: 0, outputTokens: 0 }),
      getUsageDelta: vi.fn().mockReturnValue({ inputTokensDelta: 0, outputTokensDelta: 0 }),
    };
  }

  // Simulate the session wiring logic extracted from worker-service run-finished handler.
  // This mirrors the exact code block added to worker-service.ts, testable without starting
  // an actual Electron utilityProcess or full WorkerService.
  function simulateRunFinishedSessionWiring(
    sessionService: ReturnType<typeof createMockSessionService>,
    db: {

      getActiveTaskSession: (...args: unknown[]) => { id: string; taskId: string; runCount: number; totalInputTokens: number; totalOutputTokens: number } | null;
    },
    task: { id: string } | null,
    event: { inputTokens: number | null; outputTokens: number | null; runId: string },
    connectorId: string,
  ) {
    if (task && sessionService) {
      const activeSession = db.getActiveTaskSession(task.id);
      if (activeSession) {
        sessionService.accumulateTokenUsage(
          activeSession.id,
          event.inputTokens ?? 0,
          event.outputTokens ?? 0,
          event.runId,
        );
        const rotationResult = sessionService.evaluateRotation(activeSession, connectorId);
        if (rotationResult.shouldRotate) {
          const updatedSession = db.getActiveTaskSession(task.id);
          if (updatedSession) {
            sessionService.rotateSession(updatedSession);
          }
        }
      }
    }
  }

  it("calls accumulateTokenUsage with correct args on run completion", () => {
    const sessionService = createMockSessionService();
    const mockSession = { id: "sess-1", taskId: "task-1", runCount: 5, totalInputTokens: 1000, totalOutputTokens: 500 };
    const db = { getActiveTaskSession: vi.fn().mockReturnValue(mockSession) };

    simulateRunFinishedSessionWiring(
      sessionService,
      db,
      { id: "task-1" },
      { inputTokens: 200, outputTokens: 100, runId: "run-1" },
      "gemini-cli",
    );

    expect(sessionService.accumulateTokenUsage).toHaveBeenCalledWith("sess-1", 200, 100, "run-1");
  });

  it("calls evaluateRotation after accumulation", () => {
    const sessionService = createMockSessionService();
    const mockSession = { id: "sess-1", taskId: "task-1", runCount: 5, totalInputTokens: 1000, totalOutputTokens: 500 };
    const db = { getActiveTaskSession: vi.fn().mockReturnValue(mockSession) };

    simulateRunFinishedSessionWiring(
      sessionService,
      db,
      { id: "task-1" },
      { inputTokens: 200, outputTokens: 100, runId: "run-1" },
      "gemini-cli",
    );

    expect(sessionService.evaluateRotation).toHaveBeenCalledWith(mockSession, "gemini-cli");
    // evaluateRotation called AFTER accumulateTokenUsage
    const accOrder = sessionService.accumulateTokenUsage.mock.invocationCallOrder[0];
    const evalOrder = sessionService.evaluateRotation.mock.invocationCallOrder[0];
    expect(evalOrder).toBeGreaterThan(accOrder);
  });

  it("calls rotateSession when shouldRotate is true", () => {
    const sessionService = createMockSessionService();
    sessionService.evaluateRotation.mockReturnValue({ shouldRotate: true, reason: "max_runs" });
    const mockSession = { id: "sess-1", taskId: "task-1", runCount: 20, totalInputTokens: 1000, totalOutputTokens: 500 };
    const updatedSession = { ...mockSession, runCount: 21, totalInputTokens: 1200, totalOutputTokens: 600 };
    const db = {
      getActiveTaskSession: vi.fn()
        .mockReturnValueOnce(mockSession)    // first call: get session for accumulation
        .mockReturnValueOnce(updatedSession), // second call: re-read after accumulation for rotation
    };

    simulateRunFinishedSessionWiring(
      sessionService,
      db,
      { id: "task-1" },
      { inputTokens: 200, outputTokens: 100, runId: "run-1" },
      "gemini-cli",
    );

    expect(sessionService.rotateSession).toHaveBeenCalledWith(updatedSession);
  });

  it("does NOT call rotateSession when shouldRotate is false", () => {
    const sessionService = createMockSessionService();
    sessionService.evaluateRotation.mockReturnValue({ shouldRotate: false, reason: null });
    const mockSession = { id: "sess-1", taskId: "task-1", runCount: 5, totalInputTokens: 1000, totalOutputTokens: 500 };
    const db = { getActiveTaskSession: vi.fn().mockReturnValue(mockSession) };

    simulateRunFinishedSessionWiring(
      sessionService,
      db,
      { id: "task-1" },
      { inputTokens: 200, outputTokens: 100, runId: "run-1" },
      "gemini-cli",
    );

    expect(sessionService.rotateSession).not.toHaveBeenCalled();
  });

  it("skips session wiring when task is null", () => {
    const sessionService = createMockSessionService();
    const db = { getActiveTaskSession: vi.fn() };

    simulateRunFinishedSessionWiring(
      sessionService,
      db,
      null,
      { inputTokens: 200, outputTokens: 100, runId: "run-1" },
      "gemini-cli",
    );

    expect(db.getActiveTaskSession).not.toHaveBeenCalled();
    expect(sessionService.accumulateTokenUsage).not.toHaveBeenCalled();
  });

  it("skips session wiring when no active session exists", () => {
    const sessionService = createMockSessionService();
    const db = { getActiveTaskSession: vi.fn().mockReturnValue(null) };

    simulateRunFinishedSessionWiring(
      sessionService,
      db,
      { id: "task-1" },
      { inputTokens: 200, outputTokens: 100, runId: "run-1" },
      "gemini-cli",
    );

    expect(sessionService.accumulateTokenUsage).not.toHaveBeenCalled();
  });

  it("passes null tokens as 0 to accumulateTokenUsage", () => {
    const sessionService = createMockSessionService();
    const mockSession = { id: "sess-1", taskId: "task-1", runCount: 5, totalInputTokens: 0, totalOutputTokens: 0 };
    const db = { getActiveTaskSession: vi.fn().mockReturnValue(mockSession) };

    simulateRunFinishedSessionWiring(
      sessionService,
      db,
      { id: "task-1" },
      { inputTokens: null, outputTokens: null, runId: "run-1" },
      "gemini-cli",
    );

    expect(sessionService.accumulateTokenUsage).toHaveBeenCalledWith("sess-1", 0, 0, "run-1");
  });
});
