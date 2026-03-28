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
import { createBudgetEnforcementService } from "../../src/main/budget-enforcement-service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scaffold(db: AppDatabase) {
  const companyId = db.saveCompany({
    name: "Budget Edge Case Co",
    description: "Budget exhaustion mid-run edge case tests (D-05.2)",
    status: "active",
  });
  db.saveConnector({
    id: "gemini_local",
    command: "gemini",
    model: "gemini-pro",
    envBindingText: "",
    notes: "Test connector",
  });
  const workspaceId = db.saveWorkspace({
    companyId,
    name: "Primary",
    localPath: "/tmp/budget-edge-test",
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
    connectorId: "gemini_local",
    workspaceId,
    model: null,
    capabilities: "Executes tasks",
    budgetMonthlyUsd: 100,
  });
  const goalId = db.saveGoal({
    companyId,
    title: "Ship feature",
    description: "Build budget edge case test",
    ownerAgentId: agentId,
    status: "active",
  });
  const projectId = db.saveProject({
    companyId,
    goalId,
    name: "Budget Project",
    description: "Testing budget exhaustion",
    leadAgentId: agentId,
    status: "in_progress",
    targetDate: null,
  });
  const taskId = db.saveTask({
    companyId,
    projectId,
    goalId,
    title: "Implement feature",
    description: "Build something to test budget edge cases.",
    assigneeAgentId: agentId,
    workspaceId,
    priority: "high",
    status: "todo",
  });
  return { companyId, workspaceId, agentId, goalId, projectId, taskId };
}

// ---------------------------------------------------------------------------
// Tests — Edge Case: Budget Exhaustion Mid-Run (D-05.2)
// ---------------------------------------------------------------------------

describe("Edge Case: Budget Exhaustion Mid-Run (D-05.2)", () => {
  let tempDir: string;
  let db: AppDatabase;
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const mockNotify = vi.fn();
  const mockPublish = vi.fn();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-budget-edge-"));
    db = new AppDatabase(tempDir);
    db.init();
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockNotify.mockClear();
    mockPublish.mockClear();
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("in-flight run completes normally when budget is exhausted during execution", () => {
    const { companyId, workspaceId, agentId, projectId, taskId } = scaffold(db);
    const budgetService = createBudgetEnforcementService({
      db,
      logger: mockLogger,
      notify: mockNotify,
      publishDomainChanged: mockPublish,
    });

    // Create company budget policy: 500 cents ($5), hard stop enabled
    db.saveBudgetPolicy({
      companyId,
      scopeType: "company",
      scopeId: companyId,
      amount: 500,
      hardStopEnabled: true,
    });

    // Start Run-1 (the in-flight run)
    const run1 = db.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "gemini_local",
    });
    db.checkoutTask(taskId, run1.id);
    db.markRunStatus(run1.id, "running", "");

    // Create a second task and run that exhausts budget WHILE Run-1 is in-flight
    const taskId2 = db.saveTask({
      companyId,
      title: "Other Task",
      description: "Another task that uses up budget",
      assigneeAgentId: agentId,
      workspaceId,
      priority: "medium",
      status: "todo",
    });
    const run0 = db.createRun({
      companyId,
      taskId: taskId2,
      agentId,
      workspaceId,
      connectorId: "gemini_local",
    });
    db.checkoutTask(taskId2, run0.id);
    db.markRunStatus(run0.id, "running", "");
    // Complete Run-0 with $6 cost (exceeds $5 budget)
    db.finishRun({
      runId: run0.id,
      status: "succeeded",
      summary: "Expensive run",
      errorMessage: null,
      exitCode: 0,
      signal: null,
      model: "gemini-pro",
      sessionDisplayId: null,
      costUsd: 6.0,
      unattributedCost: false,
    });

    // Now complete Run-1 (the in-flight run) -- it should succeed normally
    // Per D-04/D-05: in-flight runs are unaffected by budget exhaustion
    db.finishRun({
      runId: run1.id,
      status: "succeeded",
      summary: "In-flight run completed",
      errorMessage: null,
      exitCode: 0,
      signal: null,
      model: "gemini-pro",
      sessionDisplayId: null,
      costUsd: 0.50,
      unattributedCost: false,
    });

    // Verify Run-1 completed successfully
    const finishedRun = db.getRun(run1.id);
    expect(finishedRun.status).toBe("succeeded");

    // Verify Run-1's cost was recorded (total spend now $6.50)
    const gate = budgetService.evaluateBudgetGate(companyId, agentId, projectId);
    expect(gate.allowed).toBe(false);
    // Spent should be at least 650 cents ($6.50 = $6 + $0.50)
    expect(gate.blockedBy[0].spent).toBeGreaterThanOrEqual(650);
  });

  it("budget gate blocks next run after exhaustion", () => {
    const { companyId, workspaceId, agentId, projectId, taskId } = scaffold(db);
    const budgetService = createBudgetEnforcementService({
      db,
      logger: mockLogger,
      notify: mockNotify,
      publishDomainChanged: mockPublish,
    });

    // Create company budget policy: 500 cents ($5)
    db.saveBudgetPolicy({
      companyId,
      scopeType: "company",
      scopeId: companyId,
      amount: 500,
      hardStopEnabled: true,
    });

    // Complete a run that exceeds budget
    const run = db.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "gemini_local",
    });
    db.checkoutTask(taskId, run.id);
    db.markRunStatus(run.id, "running", "");
    db.finishRun({
      runId: run.id,
      status: "succeeded",
      summary: "Done",
      errorMessage: null,
      exitCode: 0,
      signal: null,
      model: "gemini-pro",
      sessionDisplayId: null,
      costUsd: 6.0,
      unattributedCost: false,
    });

    // Budget gate should now block
    const result = budgetService.evaluateBudgetGate(companyId, agentId, projectId);
    expect(result.allowed).toBe(false);
    expect(result.blockedBy.length).toBeGreaterThanOrEqual(1);
    expect(result.blockedBy[0].spent).toBeGreaterThanOrEqual(500);
    expect(result.blockedBy[0].limit).toBe(500);
  });

  it("budget gate returns detailed blockedBy information", () => {
    const { companyId, workspaceId, agentId, projectId, taskId } = scaffold(db);
    const budgetService = createBudgetEnforcementService({
      db,
      logger: mockLogger,
      notify: mockNotify,
      publishDomainChanged: mockPublish,
    });

    // Create company budget policy with known ID
    const policyId = db.saveBudgetPolicy({
      companyId,
      scopeType: "company",
      scopeId: companyId,
      amount: 500,
      hardStopEnabled: true,
    });

    // Exhaust budget
    const run = db.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "gemini_local",
    });
    db.checkoutTask(taskId, run.id);
    db.markRunStatus(run.id, "running", "");
    db.finishRun({
      runId: run.id,
      status: "succeeded",
      summary: "Done",
      errorMessage: null,
      exitCode: 0,
      signal: null,
      model: "gemini-pro",
      sessionDisplayId: null,
      costUsd: 6.0,
      unattributedCost: false,
    });

    const result = budgetService.evaluateBudgetGate(companyId, agentId, projectId);
    expect(result.allowed).toBe(false);
    // Verify blockedBy contains correct details
    expect(result.blockedBy[0].policyId).toBe(policyId);
    expect(result.blockedBy[0].scopeType).toBe("company");
    expect(result.blockedBy[0].scopeId).toBe(companyId);
  });

  it("agent-scope budget exhaustion blocks even when company budget has room", () => {
    const { companyId, workspaceId, agentId, projectId, taskId } = scaffold(db);
    const budgetService = createBudgetEnforcementService({
      db,
      logger: mockLogger,
      notify: mockNotify,
      publishDomainChanged: mockPublish,
    });

    // Company-level: plenty of room (10000 cents = $100)
    db.saveBudgetPolicy({
      companyId,
      scopeType: "company",
      scopeId: companyId,
      amount: 10000,
      hardStopEnabled: true,
    });

    // Agent-level: tight budget (100 cents = $1)
    db.saveBudgetPolicy({
      companyId,
      scopeType: "agent",
      scopeId: agentId,
      amount: 100,
      hardStopEnabled: true,
    });

    // Complete a run costing $1.50 (150 cents > 100 agent limit)
    const run = db.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "gemini_local",
    });
    db.checkoutTask(taskId, run.id);
    db.markRunStatus(run.id, "running", "");
    db.finishRun({
      runId: run.id,
      status: "succeeded",
      summary: "Done",
      errorMessage: null,
      exitCode: 0,
      signal: null,
      model: "gemini-pro",
      sessionDisplayId: null,
      costUsd: 1.5,
      unattributedCost: false,
    });

    const result = budgetService.evaluateBudgetGate(companyId, agentId, projectId);
    expect(result.allowed).toBe(false);
    // Should be blocked by agent scope, not company scope
    expect(result.blockedBy.length).toBe(1);
    expect(result.blockedBy[0].scopeType).toBe("agent");
    expect(result.blockedBy[0].scopeId).toBe(agentId);
  });

  it("budget gate transitions from allowed to blocked after spending", () => {
    const { companyId, workspaceId, agentId, projectId, taskId } = scaffold(db);
    const budgetService = createBudgetEnforcementService({
      db,
      logger: mockLogger,
      notify: mockNotify,
      publishDomainChanged: mockPublish,
    });

    // Create policy with 300 cents ($3) budget
    db.saveBudgetPolicy({
      companyId,
      scopeType: "company",
      scopeId: companyId,
      amount: 300,
      hardStopEnabled: true,
    });

    // Budget gate initially allows (nothing spent yet)
    const before = budgetService.evaluateBudgetGate(companyId, agentId, projectId);
    expect(before.allowed).toBe(true);

    // Complete a run costing $4 (400 cents > 300 limit)
    const run = db.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "gemini_local",
    });
    db.checkoutTask(taskId, run.id);
    db.markRunStatus(run.id, "running", "");
    db.finishRun({
      runId: run.id,
      status: "succeeded",
      summary: "Done",
      errorMessage: null,
      exitCode: 0,
      signal: null,
      model: "gemini-pro",
      sessionDisplayId: null,
      costUsd: 4.0,
      unattributedCost: false,
    });

    // Budget gate now blocks
    const after = budgetService.evaluateBudgetGate(companyId, agentId, projectId);
    expect(after.allowed).toBe(false);
    expect(after.blockedBy.length).toBeGreaterThanOrEqual(1);
  });

  it("in-flight run cost entry is recorded even when budget would be exceeded", () => {
    const { companyId, workspaceId, agentId, projectId, taskId } = scaffold(db);
    const budgetService = createBudgetEnforcementService({
      db,
      logger: mockLogger,
      notify: mockNotify,
      publishDomainChanged: mockPublish,
    });

    // Create tight budget
    db.saveBudgetPolicy({
      companyId,
      scopeType: "company",
      scopeId: companyId,
      amount: 100,
      hardStopEnabled: true,
    });

    // Run that will exceed budget on completion
    const run = db.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "gemini_local",
    });
    db.checkoutTask(taskId, run.id);
    db.markRunStatus(run.id, "running", "");

    // Complete with cost that exceeds budget -- cost entry is still recorded
    db.finishRun({
      runId: run.id,
      status: "succeeded",
      summary: "Done",
      errorMessage: null,
      exitCode: 0,
      signal: null,
      model: "gemini-pro",
      sessionDisplayId: null,
      costUsd: 5.0,
      unattributedCost: false,
    });

    // Verify cost was recorded by checking budget gate sees the spend
    const result = budgetService.evaluateBudgetGate(companyId, agentId, projectId);
    expect(result.allowed).toBe(false);
    expect(result.blockedBy[0].spent).toBe(500); // 500 cents = $5
    expect(result.blockedBy[0].limit).toBe(100);
  });
});
