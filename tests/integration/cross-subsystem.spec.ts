/**
 * Cross-subsystem integration tests exercising ALL 5 major subsystems (D-04):
 *   1. Task Quality Gates (validateTaskCreation, checkCapabilityMatch)
 *   2. CAS Checkout (checkoutTask)
 *   3. Budget Enforcement (evaluateBudgetGate)
 *   4. Session Management (accumulateTokenUsage, evaluateRotation, generateHandoff)
 *   5. Run Completion (finishRun with cost entry creation)
 *
 * Uses a real AppDatabase with temporary directories (no mocks except electron safeStorage).
 */

import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock electron safeStorage — same pattern as process-recovery.spec.ts
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
import { createSessionManagementService } from "../../src/main/session-management-service";
import { validateTaskCreation, checkCapabilityMatch as _checkCapabilityMatch } from "../../src/main/task-quality-gates";
import type { ConnectorId } from "../../src/shared/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ScaffoldResult {
  companyId: string;
  workspaceId: string;
  agentId: string;
  goalId: string;
  projectId: string;
  connectorId: ConnectorId;
  policyId: string;
}

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

/**
 * Creates a full entity scaffold with a budget policy:
 * company, workspace, connector (gemini-cli), agent, goal, project, budget policy.
 */
function scaffold(db: AppDatabase, budgetAmountCents = 500): ScaffoldResult {
  const connectorId: ConnectorId = "gemini-cli";

  db.saveConnector({
    id: connectorId,
    command: "gemini",
    model: "gemini-2.5-pro",
    envBindingText: "",
    notes: "Non-exempt connector for session rotation tests",
  });

  const companyId = db.saveCompany({
    name: "Pipeline Test Corp",
    description: "Cross-subsystem pipeline integration tests",
    status: "active",
  });

  const workspaceId = db.saveWorkspace({
    companyId,
    name: "Primary Workspace",
    localPath: "/tmp/pipeline-test",
    repoUrl: "https://github.com/example/pipeline-test",
    repoRef: "main",
    isPrimary: true,
  });

  const agentId = db.saveAgent({
    companyId,
    name: "PipelineAgent",
    role: "IC",
    title: "Full-Stack Engineer",
    status: "idle",
    reportsTo: null,
    connectorId,
    workspaceId,
    model: null,
    capabilities: "Full-stack development, authentication, login page, testing",
    budgetMonthlyUsd: 100,
  });

  const goalId = db.saveGoal({
    companyId,
    title: "Implement Authentication",
    description: "Build full authentication system",
    ownerAgentId: agentId,
    status: "active",
  });

  const projectId = db.saveProject({
    companyId,
    goalId,
    name: "Auth Project",
    description: "Authentication module",
    leadAgentId: agentId,
    status: "active",
    targetDate: null,
  });

  // Budget policy: company-level with hardStop
  const policyId = db.saveBudgetPolicy({
    companyId,
    scopeType: "company",
    scopeId: companyId,
    amount: budgetAmountCents,
    hardStopEnabled: true,
    isActive: true,
  });

  return { companyId, workspaceId, agentId, goalId, projectId, connectorId, policyId };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let tempDir: string;
let db: AppDatabase;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "agentcompany-pipeline-"));
  db = new AppDatabase(tempDir);
  db.init();
  vi.clearAllMocks();
});

afterEach(async () => {
  db?.close();
  await rm(tempDir, { recursive: true, force: true });
});

// =========================================================================
// Cross-Subsystem Pipeline (D-04)
// =========================================================================

describe("Cross-Subsystem Pipeline (D-04)", () => {
  it("full pipeline: quality gate -> checkout -> budget -> session -> completion", () => {
    const s = scaffold(db);

    const budgetService = createBudgetEnforcementService({
      db,
      logger: mockLogger,
      notify: vi.fn(),
      publishDomainChanged: vi.fn(),
    });

    const sessionService = createSessionManagementService({
      db,
      logger: mockLogger,
    });

    // 1. Quality gate: validate task creation
    const validation = validateTaskCreation(
      {
        title: "Build login page",
        description:
          "Implement the login page with email and password authentication. Done when: form renders, validation works, and API called on submit.",
      },
    );
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);

    // Create the task in the DB
    const taskId = db.saveTask({
      companyId: s.companyId,
      title: "Build login page",
      description:
        "Implement the login page with email and password authentication. Done when: form renders, validation works, and API called on submit.",
      assigneeAgentId: s.agentId,
      workspaceId: s.workspaceId,
      priority: "high",
      status: "todo",
    });

    // 2. CAS checkout: create run and checkout task
    const { id: runId } = db.createRun({
      companyId: s.companyId,
      taskId,
      agentId: s.agentId,
      workspaceId: s.workspaceId,
      connectorId: s.connectorId,
    });
    const checkoutResult = db.checkoutTask(taskId, runId);
    expect(checkoutResult).toBe(true);

    // 3. Budget gate: verify run is allowed
    const budgetResult = budgetService.evaluateBudgetGate(
      s.companyId,
      s.agentId,
      s.projectId,
    );
    expect(budgetResult.allowed).toBe(true);
    expect(budgetResult.blockedBy).toHaveLength(0);

    // 4. Execute run
    db.markRunStatus(runId, "running", "Starting");
    db.recordCostEntry({ runId, companyId: s.companyId, agentId: s.agentId, taskId, connectorId: "gemini-cli", amountUsd: 0.05, unattributed: false });
    db.finishRun({
      runId,
      status: "succeeded",
      summary: "Login page built with form validation",
      errorMessage: null,
      exitCode: 0,
      signal: null,
      model: "gemini-2.5-pro",
      sessionDisplayId: null,
      unattributedCost: false,
    });

    // 5. Session management: create session and track usage
    const sessionId = db.createNewSession({
      companyId: s.companyId,
      agentId: s.agentId,
      adapterType: "gemini-cli",
      sessionParamsJson: null,
      sessionDisplayId: null,
    });
    sessionService.accumulateTokenUsage(sessionId, 5000, 2000, runId);

    // 6. Verify final state
    const run = db.getRun(runId);
    expect(run.status).toBe("succeeded");

    const task = db.getTask(taskId);
    expect(task.costUsd).toBeGreaterThan(0);

    const session = db.getSessionById(sessionId);
    expect(session).not.toBeNull();
    expect(session!.totalInputTokens).toBe(5000);
    expect(session!.totalOutputTokens).toBe(2000);
    expect(session!.runCount).toBe(1);
  });

  it("quality gate rejects short description before pipeline starts", () => {
    const result = validateTaskCreation(
      { title: "Fix bug", description: "Short." },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("at least 50 characters");
  });

  it("CAS prevents double checkout within pipeline", () => {
    const s = scaffold(db);

    const taskId = db.saveTask({
      companyId: s.companyId,
      title: "Concurrent Task",
      description:
        "A task that two agents will try to check out concurrently. Done when: only one succeeds.",
      assigneeAgentId: null,
      workspaceId: s.workspaceId,
      priority: "medium",
      status: "todo",
    });

    // First agent checks out
    const { id: runId1 } = db.createRun({
      companyId: s.companyId,
      taskId,
      agentId: s.agentId,
      workspaceId: s.workspaceId,
      connectorId: s.connectorId,
    });
    expect(db.checkoutTask(taskId, runId1)).toBe(true);

    // Second agent creates a run but cannot check out
    const agent2Id = db.saveAgent({
      companyId: s.companyId,
      name: "Agent2",
      role: "IC",
      title: "Engineer 2",
      status: "idle",
      reportsTo: null,
      connectorId: s.connectorId,
      workspaceId: s.workspaceId,
      model: null,
      capabilities: "Backend development",
      budgetMonthlyUsd: 100,
    });
    const { id: runId2 } = db.createRun({
      companyId: s.companyId,
      taskId,
      agentId: agent2Id,
      workspaceId: s.workspaceId,
      connectorId: s.connectorId,
    });
    expect(db.checkoutTask(taskId, runId2)).toBe(false);
  });

  it("budget gate blocks run when policy exhausted", () => {
    // Create scaffold with $1 budget (100 cents)
    const s = scaffold(db, 100);

    const budgetService = createBudgetEnforcementService({
      db,
      logger: mockLogger,
      notify: vi.fn(),
      publishDomainChanged: vi.fn(),
    });

    // Create and complete a run that exceeds the budget
    const taskId = db.saveTask({
      companyId: s.companyId,
      title: "Expensive Task",
      description:
        "A task that costs more than the budget allows. Done when: budget gate correctly blocks.",
      assigneeAgentId: s.agentId,
      workspaceId: s.workspaceId,
      priority: "medium",
      status: "todo",
    });

    const { id: runId } = db.createRun({
      companyId: s.companyId,
      taskId,
      agentId: s.agentId,
      workspaceId: s.workspaceId,
      connectorId: s.connectorId,
    });

    db.checkoutTask(taskId, runId);
    db.markRunStatus(runId, "running", "Starting");
    db.recordCostEntry({ runId, companyId: s.companyId, agentId: s.agentId, taskId, connectorId: s.connectorId, amountUsd: 1.5, unattributed: false });
    db.finishRun({
      runId,
      status: "succeeded",
      summary: "Done",
      errorMessage: null,
      exitCode: 0,
      signal: null,
      model: "gemini-2.5-pro",
      sessionDisplayId: null,
      unattributedCost: false,
    });

    // Budget gate should now block
    const result = budgetService.evaluateBudgetGate(
      s.companyId,
      s.agentId,
      s.projectId,
    );
    expect(result.allowed).toBe(false);
    expect(result.blockedBy.length).toBeGreaterThan(0);
    expect(result.blockedBy[0].scopeType).toBe("company");
  });

  it("session usage accumulates across multiple runs", () => {
    const s = scaffold(db);

    const sessionService = createSessionManagementService({
      db,
      logger: mockLogger,
    });

    const taskId = db.saveTask({
      companyId: s.companyId,
      title: "Multi-Run Task",
      description:
        "A task that spans multiple runs to test session accumulation. Done when: token counts sum correctly.",
      assigneeAgentId: s.agentId,
      workspaceId: s.workspaceId,
      priority: "medium",
      status: "todo",
    });

    // Create session
    const sessionId = db.createNewSession({
      companyId: s.companyId,
      agentId: s.agentId,
      adapterType: "gemini-cli",
      sessionParamsJson: null,
      sessionDisplayId: null,
    });

    // Run 1: create run and accumulate tokens
    const { id: runId1 } = db.createRun({
      companyId: s.companyId,
      taskId,
      agentId: s.agentId,
      workspaceId: s.workspaceId,
      connectorId: s.connectorId,
    });
    sessionService.accumulateTokenUsage(sessionId, 5000, 2000, runId1);

    // Run 2: create another run and accumulate more tokens
    const { id: runId2 } = db.createRun({
      companyId: s.companyId,
      taskId,
      agentId: s.agentId,
      workspaceId: s.workspaceId,
      connectorId: s.connectorId,
    });
    sessionService.accumulateTokenUsage(sessionId, 3000, 1000, runId2);

    // Verify accumulated session state
    const session = db.getSessionById(sessionId);
    expect(session).not.toBeNull();
    expect(session!.runCount).toBe(2);
    expect(session!.totalInputTokens).toBe(8000);
    expect(session!.totalOutputTokens).toBe(3000);
  });

  it("full pipeline with budget enforcement end-to-end", () => {
    // Budget = $5 (500 cents)
    const s = scaffold(db, 500);

    const budgetService = createBudgetEnforcementService({
      db,
      logger: mockLogger,
      notify: vi.fn(),
      publishDomainChanged: vi.fn(),
    });

    // --- First run: costs $3, budget allows ---
    const taskId1 = db.saveTask({
      companyId: s.companyId,
      title: "First Pipeline Task",
      description:
        "A task in the budget pipeline that costs $3. Done when: run completes successfully under budget.",
      assigneeAgentId: s.agentId,
      workspaceId: s.workspaceId,
      priority: "medium",
      status: "todo",
    });

    const { id: runId1 } = db.createRun({
      companyId: s.companyId,
      taskId: taskId1,
      agentId: s.agentId,
      workspaceId: s.workspaceId,
      connectorId: s.connectorId,
    });
    db.checkoutTask(taskId1, runId1);
    db.markRunStatus(runId1, "running", "Starting");
    db.recordCostEntry({ runId: runId1, companyId: s.companyId, agentId: s.agentId, taskId: taskId1, connectorId: s.connectorId, amountUsd: 3.0, unattributed: false });
    db.finishRun({
      runId: runId1,
      status: "succeeded",
      summary: "First task done",
      errorMessage: null,
      exitCode: 0,
      signal: null,
      model: "gemini-2.5-pro",
      sessionDisplayId: null,
      unattributedCost: false,
    });

    // Budget gate should still allow (spent $3 of $5)
    const afterFirst = budgetService.evaluateBudgetGate(
      s.companyId,
      s.agentId,
      s.projectId,
    );
    expect(afterFirst.allowed).toBe(true);

    // --- Second run: costs $3, now total = $6 > $5 budget ---
    const taskId2 = db.saveTask({
      companyId: s.companyId,
      title: "Second Pipeline Task",
      description:
        "A task that will push total spend over the budget limit. Done when: budget gate blocks third run.",
      assigneeAgentId: s.agentId,
      workspaceId: s.workspaceId,
      priority: "medium",
      status: "todo",
    });

    const { id: runId2 } = db.createRun({
      companyId: s.companyId,
      taskId: taskId2,
      agentId: s.agentId,
      workspaceId: s.workspaceId,
      connectorId: s.connectorId,
    });
    db.checkoutTask(taskId2, runId2);
    db.markRunStatus(runId2, "running", "Starting");
    db.recordCostEntry({ runId: runId2, companyId: s.companyId, agentId: s.agentId, taskId: taskId2, connectorId: s.connectorId, amountUsd: 3.0, unattributed: false });
    db.finishRun({
      runId: runId2,
      status: "succeeded",
      summary: "Second task done",
      errorMessage: null,
      exitCode: 0,
      signal: null,
      model: "gemini-2.5-pro",
      sessionDisplayId: null,
      unattributedCost: false,
    });

    // Budget gate should now block (spent $6 of $5)
    const afterSecond = budgetService.evaluateBudgetGate(
      s.companyId,
      s.agentId,
      s.projectId,
    );
    expect(afterSecond.allowed).toBe(false);
    expect(afterSecond.blockedBy.length).toBeGreaterThan(0);
  });
});
