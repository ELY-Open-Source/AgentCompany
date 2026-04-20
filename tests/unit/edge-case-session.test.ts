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
import { createSessionManagementService } from "../../src/main/session-management-service";
import type { ConnectorId } from "@shared/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scaffold(db: AppDatabase, connectorId: ConnectorId = "gemini-cli") {
  const companyId = db.company.saveCompany({
    name: "Session Edge Case Co",
    description: "Session rotation edge case tests (D-05.3)",
    status: "active",
  });

  // Always save gemini-cli (needed for most tests)
  db.saveConnector({
    id: "gemini-cli",
    model: "gemini-pro",
    envBindingText: "",
    notes: "Test connector - no native context management",
  });

  const workspaceId = db.saveWorkspace({
    companyId,
    name: "Primary",
    localPath: "/tmp/session-edge-test",
    repoUrl: "",
    repoRef: "",
    isPrimary: true,
  });
  const agentId = db.agents.saveAgent({
    companyId,
    name: "Worker Agent",
    role: "developer",
    title: "Developer",
    status: "active",
    reportsTo: null,
    connectorId,
    workspaceId,
    model: null,
    capabilities: "Executes tasks",
    budgetMonthlyUsd: 100,
  });
  const goalId = db.saveGoal({
    companyId,
    title: "Ship feature",
    description: "Build session rotation edge case test",
    ownerAgentId: agentId,
    status: "active",
  });
  const projectId = db.saveProject({
    companyId,
    goalId,
    name: "Session Project",
    description: "Testing session rotation during execution",
    leadAgentId: agentId,
    status: "in_progress",
    targetDate: null,
  });
  const taskId = db.tasks.saveTask({
    companyId,
    projectId,
    goalId,
    title: "Implement session rotation feature",
    description: "Build the session rotation logic for task execution edge cases.",
    assigneeAgentId: agentId,
    workspaceId,
    priority: "high",
    status: "in_progress",
  });
  return { companyId, workspaceId, agentId, goalId, projectId, taskId };
}

// ---------------------------------------------------------------------------
// Tests -- Edge Case: Session Rotation During Execution (D-05.3)
// ---------------------------------------------------------------------------

describe("Edge Case: Session Rotation During Execution (D-05.3)", () => {
  let tempDir: string;
  let db: AppDatabase;
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-session-edge-"));
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

  it("rotation triggered when run count exceeds maxRuns threshold", () => {
    const { companyId, agentId, taskId } = scaffold(db);
    const sessionService = createSessionManagementService({ db, logger: mockLogger });

    // Create a session
    const sessionId = db.tasks.createNewSession({
      companyId,
      agentId,
      adapterType: "gemini-cli",
    });

    // Simulate runs until we reach the maxRuns threshold (20)
    for (let i = 0; i < 20; i++) {
      db.tasks.incrementSessionUsage(sessionId, 1000, 500, `run-${i}`);
    }

    // Get the updated session from DB
    const session = db.tasks.getSessionById(sessionId);
    expect(session).not.toBeNull();
    expect(session!.runCount).toBe(20);  // matches maxRuns threshold in session-management-service

    // Evaluate rotation -- should trigger
    const result = sessionService.evaluateRotation(session!);
    expect(result.shouldRotate).toBe(true);
    expect(result.reason).toBe("max_runs");
  });

  it("rotation triggered when token count exceeds maxTokens threshold", () => {
    const { companyId, agentId, taskId } = scaffold(db);
    const sessionService = createSessionManagementService({ db, logger: mockLogger });

    const sessionId = db.tasks.createNewSession({
      companyId,
      agentId,
      adapterType: "gemini-cli",
    });

    // Accumulate tokens past the 500_000 maxTokens threshold in one big call
    db.tasks.incrementSessionUsage(sessionId, 300000, 250000, "big-run");

    const session = db.tasks.getSessionById(sessionId);
    expect(session).not.toBeNull();
    const totalTokens = session!.totalInputTokens + session!.totalOutputTokens;
    expect(totalTokens).toBe(550000);

    const result = sessionService.evaluateRotation(session!);
    expect(result.shouldRotate).toBe(true);
    expect(result.reason).toBe("max_tokens");
  });

  it("handoff markdown generated before next run starts", () => {
    const { companyId, agentId, taskId, workspaceId } = scaffold(db);
    const sessionService = createSessionManagementService({ db, logger: mockLogger });

    const sessionId = db.tasks.createNewSession({
      companyId,
      agentId,
      adapterType: "gemini-cli",
    });

    // Accumulate enough to trigger rotation
    for (let i = 0; i < 20; i++) {
      db.tasks.incrementSessionUsage(sessionId, 1000, 500, `run-${i}`);
    }

    // Create a completed run for history (so generateHandoff has run data)
    const run = db.runs.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "gemini-cli" as ConnectorId,
    });
    db.runs.finishRun({
      runId: run.id,
      status: "succeeded",
      summary: "Completed initial implementation",
      errorMessage: null,
      exitCode: 0,
      signal: null,
      model: "gemini-pro",
      unattributedCost: false,
    });

    const session = db.tasks.getSessionById(sessionId)!;
    // generateHandoff is agent-scoped: it walks the agent's runs across
    // all tasks + taskless heartbeats, not a single task.
    const handoff = sessionService.generateHandoff(session);

    // Verify handoff markdown content
    expect(handoff).toContain("# Session Handoff");
    expect(handoff).toContain("## Recent Run History");

    // Archive the old session with handoff
    db.tasks.archiveSession(sessionId, "max_runs", handoff);

    // Verify archived session has handoff stored
    const archivedRows = db.queryAll<{ handoffMarkdown: string | null }>(
      "SELECT handoff_markdown as handoffMarkdown FROM task_sessions WHERE id = ?",
      sessionId,
    );
    expect(archivedRows[0].handoffMarkdown).toContain("# Session Handoff");
  });

  it("new session created after rotation with clean counters", () => {
    const { companyId, agentId, taskId } = scaffold(db);

    // Create initial session
    const oldSessionId = db.tasks.createNewSession({
      companyId,
      agentId,
      adapterType: "gemini-cli",
    });

    // Add usage to the old session
    db.tasks.incrementSessionUsage(oldSessionId, 300000, 250000, "run-final");

    // Archive the old session
    db.tasks.archiveSession(oldSessionId, "max_tokens", "# Session Handoff\nPrevious work summary.");

    // Create new session
    const newSessionId = db.tasks.createNewSession({
      companyId,
      agentId,
      adapterType: "gemini-cli",
    });

    // Get the new active session
    const newSession = db.tasks.getSessionById(newSessionId);
    expect(newSession).not.toBeNull();
    expect(newSession!.id).toBe(newSessionId);
    expect(newSession!.id).not.toBe(oldSessionId);

    // Verify clean counters
    expect(newSession!.runCount).toBe(0);
    expect(newSession!.totalInputTokens).toBe(0);
    expect(newSession!.totalOutputTokens).toBe(0);
  });

  it("claude connector triggers rotation under pi-mono (no native exemption)", () => {
    const { companyId, agentId, taskId } = scaffold(db, "gemini-cli");
    const sessionService = createSessionManagementService({ db, logger: mockLogger });

    const sessionId = db.tasks.createNewSession({
      companyId,
      agentId,
      adapterType: "claude-pro",
    });

    // Accumulate way past all thresholds
    for (let i = 0; i < 25; i++) {
      db.tasks.incrementSessionUsage(sessionId, 30000, 20000, `run-${i}`);
    }

    const session = db.tasks.getSessionById(sessionId)!;
    // Pi-mono delegates compaction to pi-agent-core; AgentCompany still applies rotation uniformly.
    const result = sessionService.evaluateRotation(session);
    expect(result.shouldRotate).toBe(true);
    expect(result.reason).not.toBeNull();
  });

  it("codex connector triggers rotation under pi-mono (no native exemption)", () => {
    const { companyId, agentId, taskId } = scaffold(db, "gemini-cli");
    const sessionService = createSessionManagementService({ db, logger: mockLogger });

    const sessionId = db.tasks.createNewSession({
      companyId,
      agentId,
      adapterType: "openai-codex",
    });

    // Accumulate way past all thresholds
    for (let i = 0; i < 25; i++) {
      db.tasks.incrementSessionUsage(sessionId, 30000, 20000, `run-${i}`);
    }

    const session = db.tasks.getSessionById(sessionId)!;
    // Pi-mono delegates compaction to pi-agent-core; AgentCompany still applies rotation uniformly.
    const result = sessionService.evaluateRotation(session);
    expect(result.shouldRotate).toBe(true);
    expect(result.reason).not.toBeNull();
  });

  it("handoff markdown available for next run context after rotation", () => {
    const { companyId, agentId, taskId, workspaceId } = scaffold(db);
    const sessionService = createSessionManagementService({ db, logger: mockLogger });

    // Create session and add usage
    const sessionId = db.tasks.createNewSession({
      companyId,
      agentId,
      adapterType: "gemini-cli",
    });
    db.tasks.incrementSessionUsage(sessionId, 300000, 200000, "run-1");

    // Create a completed run for run history
    const run = db.runs.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "gemini-cli" as ConnectorId,
    });
    db.runs.finishRun({
      runId: run.id,
      status: "succeeded",
      summary: "Previous work done",
      errorMessage: null,
      exitCode: 0,
      signal: null,
      model: "gemini-pro",
      unattributedCost: false,
    });

    // Rotate the session (archives old, creates new)
    const oldSession = db.tasks.getSessionById(sessionId)!;
    sessionService.rotateSession(oldSession);

    // After rotation, the handoff should be retrievable for the next run
    const handoff = sessionService.getHandoffContext(taskId);
    expect(handoff).not.toBeNull();
    expect(handoff).toContain("# Session Handoff");
    expect(handoff).toContain("Implement session rotation feature"); // task title from scaffold
  });
});
