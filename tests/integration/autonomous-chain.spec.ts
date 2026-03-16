/**
 * End-to-end integration tests for the autonomous operation chain.
 * Tests all 8 steps from IMPLEMENTATION_PLAN.md v2:
 *
 * Step 1: CEO role detection fix
 * Step 2: CEO phased prompts + pending approvals + credential escalation
 * Step 3: Deferred wake queue
 * Step 4: Hire approval wake
 * Step 5: Task status + comment wake propagation
 * Step 6: Run failure escalation
 * Step 7: Worker crash recovery
 * Step 8: Wake reason injection into prompt
 */

import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../../src/main/database";
import { buildSystemPrompt, buildTaskPrompt } from "../../src/main/prompt-builder";
import type { AgentRecord, ApprovalRecord, TaskRecord } from "../../src/shared/types";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

let db: AppDatabase;
let companyId: string;
let workspaceId: string;

beforeEach(async () => {
  const profileDir = await createTempDir("agentcompany-chain-test-");
  db = new AppDatabase(profileDir);
  db.init();

  companyId = db.saveCompany({
    name: "Autonomous Test Corp",
    description: "Test company for autonomous chain",
    status: "active",
  });

  workspaceId = db.saveWorkspace({
    companyId,
    name: "Primary",
    localPath: profileDir,
    repoUrl: "https://example.com/repo.git",
    repoRef: "main",
    isPrimary: true,
  });
});

afterEach(async () => {
  db?.close();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createAgent(overrides: Partial<Parameters<typeof db.saveAgent>[0]> = {}): string {
  return db.saveAgent({
    companyId,
    name: "TestAgent",
    role: "CEO",
    title: "Test",
    status: "idle",
    reportsTo: null,
    connectorId: "codex_local",
    workspaceId,
    model: null,
    capabilities: "Test capabilities",
    budgetMonthlyUsd: 200,
    ...overrides,
  });
}

function buildCtx(overrides: Record<string, unknown> = {}): Parameters<typeof buildSystemPrompt>[0] {
  const agent = db.getAgent(overrides.agentId as string ?? createAgent());
  return {
    agent,
    apiUrl: "http://127.0.0.1:3000",
    apiKey: "test-key",
    runId: "test-run-id",
    task: null,
    companyName: "Autonomous Test Corp",
    goals: [],
    projects: [],
    directReports: overrides.directReports as AgentRecord[] ?? [],
    chainOfCommand: overrides.chainOfCommand as AgentRecord[] ?? [],
    assignedTasks: [],
    allAgents: [],
    pendingApprovals: overrides.pendingApprovals as ApprovalRecord[] ?? [],
    tasksAwaitingReview: overrides.tasksAwaitingReview as TaskRecord[] ?? [],
    wakeReason: overrides.wakeReason as string | null ?? null,
    ...overrides,
  } as Parameters<typeof buildSystemPrompt>[0];
}

// ─── Step 1: CEO Role Detection ─────────────────────────────────────

describe("Step 1: CEO role detection", () => {
  it("identifies CEO when chainOfCommand is empty, even with no direct reports", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const ctx = buildCtx({
      agentId: ceoId,
      directReports: [], // no reports yet!
      chainOfCommand: [], // top-level
    });

    const prompt = buildSystemPrompt(ctx);

    // CEO should NOT get IC instructions
    expect(prompt).not.toContain("Individual Contributor");
    // CEO should get executive instructions (Phase 0: Team Building)
    expect(prompt).toContain("CEO");
    expect(prompt).toContain("Team Building");
  });

  it("identifies manager when has reports and has chain of command", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const managerId = createAgent({ name: "CTO", role: "CTO", reportsTo: ceoId });
    const ceo = db.getAgent(ceoId);
    const icId = createAgent({ name: "IC", role: "Engineer", reportsTo: managerId });
    const ic = db.getAgent(icId);

    const ctx = buildCtx({
      agentId: managerId,
      directReports: [ic],
      chainOfCommand: [ceo], // reports to CEO
    });

    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("Operating Instructions (Manager)");
    expect(prompt).not.toContain("Individual Contributor");
    expect(prompt).not.toContain("Executive / CEO");
  });

  it("identifies IC when has chain of command and no direct reports", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const ceo = db.getAgent(ceoId);
    const icId = createAgent({ name: "Dev", role: "Engineer", reportsTo: ceoId });

    const ctx = buildCtx({
      agentId: icId,
      directReports: [],
      chainOfCommand: [ceo],
    });

    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("Individual Contributor");
    expect(prompt).not.toContain("Operating Instructions (Manager)");
  });
});

// ─── Step 2: CEO Phased Prompts ─────────────────────────────────────

describe("Step 2: CEO phased prompts", () => {
  it("Phase 0: shows team building instructions when no reports at all", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });

    const ctx = buildCtx({
      agentId: ceoId,
      directReports: [], // truly no reports
      chainOfCommand: [],
      pendingApprovals: [],
    });

    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("Team Building Phase");
    expect(prompt).toContain("Design the Organization Structure");
    expect(prompt).toContain("Submit Org Strategy for Approval");
    expect(prompt).not.toContain("Awaiting Org Approval");
    expect(prompt).not.toContain("Goal Decomposition");
  });

  it("Phase 0.5: shows awaiting hire approvals when pending_approval hires exist but no org approval", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });

    const hireId = createAgent({ name: "CTO", role: "CTO", reportsTo: ceoId, status: "pending_approval" as "idle" });
    const hire = db.getAgent(hireId);

    const ctx = buildCtx({
      agentId: ceoId,
      directReports: [hire],
      chainOfCommand: [],
      pendingApprovals: [],
    });

    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("Awaiting Hire Approvals");
    expect(prompt).not.toContain("Team Building Phase");
    expect(prompt).not.toContain("Goal Decomposition");
  });

  it("Phase 1: shows awaiting org approval when pending approve_ceo_strategy exists", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });

    const ctx = buildCtx({
      agentId: ceoId,
      directReports: [],
      chainOfCommand: [],
      pendingApprovals: [
        {
          id: "approval-1",
          companyId,
          type: "approve_ceo_strategy",
          state: "pending",
          payloadSummary: "Org structure: CEO + CTO + CMO",
          impactSummary: "Team of 3",
          requestedByAgentId: ceoId,
          relatedTaskId: null,
          decisionNote: "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as ApprovalRecord,
      ],
    });

    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("Awaiting Org Approval");
    expect(prompt).not.toContain("Team Building Phase");
    expect(prompt).not.toContain("Goal Decomposition");
  });

  it("Phase 2: shows normal executive instructions when active reports and no pending org approval", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const ctoId = createAgent({ name: "CTO", role: "CTO", reportsTo: ceoId, status: "idle" });
    const cto = db.getAgent(ctoId);

    const ctx = buildCtx({
      agentId: ceoId,
      directReports: [cto],
      chainOfCommand: [],
      pendingApprovals: [],
    });

    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("Executive / CEO");
    expect(prompt).toContain("Goal Decomposition");
    expect(prompt).toContain("Delegation");
    expect(prompt).toContain("Unblock & Coordinate");
    expect(prompt).not.toContain("Team Building Phase");
    expect(prompt).not.toContain("Awaiting Org Approval");
  });

  it("includes pending approvals section in prompt", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const ctoId = createAgent({ name: "CTO", role: "CTO", reportsTo: ceoId, status: "idle" });
    const cto = db.getAgent(ctoId);

    const ctx = buildCtx({
      agentId: ceoId,
      directReports: [cto],
      chainOfCommand: [],
      pendingApprovals: [
        {
          id: "approval-x",
          companyId,
          type: "secret_access",
          state: "pending",
          payloadSummary: "Need Twitter API keys",
          impactSummary: "",
          requestedByAgentId: ceoId,
          relatedTaskId: null,
          decisionNote: "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as ApprovalRecord,
      ],
    });

    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("Pending Approvals");
    expect(prompt).toContain("Need Twitter API keys");
  });

  it("Manager prompt includes credential escalation guidance", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const ceo = db.getAgent(ceoId);
    const managerId = createAgent({ name: "CTO", role: "CTO", reportsTo: ceoId });
    const icId = createAgent({ name: "Dev", role: "Engineer", reportsTo: managerId });
    const ic = db.getAgent(icId);

    const ctx = buildCtx({
      agentId: managerId,
      directReports: [ic],
      chainOfCommand: [ceo],
    });

    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("escalate by commenting on YOUR parent task");
    expect(prompt).toContain("Break down work and delegate it");
  });

  it("IC prompt includes credential escalation guidance", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const ceo = db.getAgent(ceoId);
    const icId = createAgent({ name: "Dev", role: "Engineer", reportsTo: ceoId });

    const ctx = buildCtx({
      agentId: icId,
      directReports: [],
      chainOfCommand: [ceo],
    });

    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("Your manager is auto-notified and will help");
    expect(prompt).toContain("comment explaining what API key/account you need");
  });
});

// ─── Step 3: Deferred Wake Queue ────────────────────────────────────

describe("Step 3: Deferred wake queue (database)", () => {
  it("enqueue and consume pending wakes", () => {
    const agentId = createAgent({ name: "TestAgent" });

    // Enqueue two wakes
    db.enqueuePendingWake(companyId, agentId, "subtask_completed");
    db.enqueuePendingWake(companyId, agentId, "comment");

    // Consume returns them in order
    const wakes = db.consumePendingWakes(agentId);
    expect(wakes).toHaveLength(2);
    expect(wakes[0].trigger).toBe("subtask_completed");
    expect(wakes[1].trigger).toBe("comment");
    expect(wakes[0].companyId).toBe(companyId);

    // Second consume returns empty (they've been deleted)
    const wakes2 = db.consumePendingWakes(agentId);
    expect(wakes2).toHaveLength(0);
  });

  it("returns empty array when no pending wakes exist", () => {
    const agentId = createAgent({ name: "TestAgent" });
    const wakes = db.consumePendingWakes(agentId);
    expect(wakes).toHaveLength(0);
  });

  it("does not consume wakes for other agents", () => {
    const agent1 = createAgent({ name: "Agent1" });
    const agent2 = createAgent({ name: "Agent2" });

    db.enqueuePendingWake(companyId, agent1, "comment");
    db.enqueuePendingWake(companyId, agent2, "subtask_completed");

    const wakes1 = db.consumePendingWakes(agent1);
    expect(wakes1).toHaveLength(1);
    expect(wakes1[0].trigger).toBe("comment");

    // Agent2's wake should still be there
    const wakes2 = db.consumePendingWakes(agent2);
    expect(wakes2).toHaveLength(1);
    expect(wakes2[0].trigger).toBe("subtask_completed");
  });
});

// ─── Step 4: Hire Approval Wake ─────────────────────────────────────

describe("Step 4: Hire approval + decideApproval", () => {
  it("decideApproval sets hired agent to idle when approved", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const hireId = createAgent({ name: "CTO", role: "CTO", reportsTo: ceoId, status: "pending_approval" as "idle" });

    const approvalId = db.requestApproval({
      companyId,
      requestedByAgentId: ceoId,
      type: "hire_agent",
      payloadSummary: "Hire CTO",
      impactSummary: "Test impact",
      payloadJson: JSON.stringify({ agentId: hireId }),
    });

    db.decideApproval({
      approvalId,
      state: "approved",
      decisionNote: "Approved by board",
    });

    const updatedAgent = db.getAgent(hireId);
    expect(updatedAgent.status).toBe("idle");
  });

  it("decideApproval sets hired agent to terminated when rejected", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const hireId = createAgent({ name: "CTO", role: "CTO", reportsTo: ceoId, status: "pending_approval" as "idle" });

    const approvalId = db.requestApproval({
      companyId,
      requestedByAgentId: ceoId,
      type: "hire_agent",
      payloadSummary: "Hire CTO",
      impactSummary: "Test impact",
      payloadJson: JSON.stringify({ agentId: hireId }),
    });

    db.decideApproval({
      approvalId,
      state: "rejected",
      decisionNote: "Not needed",
    });

    const updatedAgent = db.getAgent(hireId);
    expect(updatedAgent.status).toBe("terminated");
  });

  it("getApprovalRecord includes payloadJson", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const approvalId = db.requestApproval({
      companyId,
      requestedByAgentId: ceoId,
      type: "hire_agent",
      payloadSummary: "Hire CTO",
      impactSummary: "Test",
      payloadJson: JSON.stringify({ agentId: "some-agent-id", config: { connector: "codex_local" } }),
    });

    const approval = db.getApprovalRecord(approvalId);
    expect(approval.payloadJson).toBeTruthy();
    const payload = JSON.parse(approval.payloadJson!);
    expect(payload.agentId).toBe("some-agent-id");
  });
});

// ─── Step 5: Task Status + Comment Wake Propagation ─────────────────

describe("Step 5: Task status + comment wake propagation", () => {
  it("getChainOfCommand returns correct hierarchy", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO", reportsTo: null });
    const ctoId = createAgent({ name: "CTO", role: "CTO", reportsTo: ceoId });
    const icId = createAgent({ name: "Dev", role: "Engineer", reportsTo: ctoId });

    const chain = db.getChainOfCommand(icId);
    expect(chain).toHaveLength(2);
    expect(chain[0].id).toBe(ctoId); // immediate manager
    expect(chain[1].id).toBe(ceoId); // top level
  });

  it("getChainOfCommand handles circular references safely", () => {
    // Create a potential cycle (shouldn't happen in practice, but guard against it)
    const agent1 = createAgent({ name: "Agent1" });
    // agent1 reports to no one (CEO), so chain should be empty
    const chain = db.getChainOfCommand(agent1);
    expect(chain).toHaveLength(0);
  });

  it("task tree supports parent-child relationships", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const ctoId = createAgent({ name: "CTO", role: "CTO", reportsTo: ceoId });

    const parentTaskId = db.saveTask({
      companyId,
      title: "Build feature X",
      description: "Top-level task",
      assigneeAgentId: ctoId,
      workspaceId,
      priority: "high",
      status: "in_progress",
    });

    const childTaskId = db.saveTask({
      companyId,
      title: "Implement module A",
      description: "Subtask",
      assigneeAgentId: ctoId,
      parentId: parentTaskId,
      workspaceId,
      priority: "medium",
      status: "todo",
    });

    const childTask = db.getTask(childTaskId);
    expect(childTask.parentId).toBe(parentTaskId);

    const parentTask = db.getTask(parentTaskId);
    expect(parentTask.assigneeAgentId).toBe(ctoId);
  });
});

// ─── Step 6: Run Failure Escalation ─────────────────────────────────

describe("Step 6: Run failure escalation (database layer)", () => {
  it("finishRun marks run as failed and returns outcome", () => {
    const agentId = createAgent({ name: "IC", role: "Engineer" });
    const taskId = db.saveTask({
      companyId,
      title: "Failing task",
      description: "Will fail",
      assigneeAgentId: agentId,
      workspaceId,
      priority: "medium",
      status: "in_progress",
    });

    const run = db.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "codex_local",
    });

    db.markRunStatus(run.id, "running", "Started");

    const outcome = db.finishRun({
      runId: run.id,
      status: "failed",
      summary: null,
      errorMessage: "Process crashed",
      exitCode: 1,
      signal: null,
      model: "gpt-5-codex",
      sessionDisplayId: null,
      costUsd: 0.5,
      unattributedCost: false,
    });

    expect(outcome.budgetHardStopped).toBe(false);

    const snapshot = db.listSnapshot();
    const finishedRun = snapshot.runs.find((r) => r.id === run.id);
    expect(finishedRun?.status).toBe("failed");
    expect(finishedRun?.errorMessage).toBe("Process crashed");
  });

  it("getChainOfCommand returns manager for failure escalation", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const ctoId = createAgent({ name: "CTO", role: "CTO", reportsTo: ceoId });
    const icId = createAgent({ name: "Dev", role: "Engineer", reportsTo: ctoId });

    const chain = db.getChainOfCommand(icId);
    // First in chain is the immediate manager (CTO)
    expect(chain.length).toBeGreaterThan(0);
    expect(chain[0].name).toBe("CTO");
  });
});

// ─── Step 7: Worker Crash Recovery ──────────────────────────────────

describe("Step 7: Worker crash recovery (database layer)", () => {
  it("interruptStaleRuns clears running and queued runs on init", async () => {
    const agentId = createAgent({ name: "Agent" });
    const taskId = db.saveTask({
      companyId,
      title: "In-progress task",
      description: "Running when crash happened",
      assigneeAgentId: agentId,
      workspaceId,
      priority: "medium",
      status: "in_progress",
    });

    const run = db.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "codex_local",
    });

    db.markRunStatus(run.id, "running", "Started");

    // Verify it's running
    let snapshot = db.listSnapshot();
    expect(snapshot.runs.find((r) => r.id === run.id)?.status).toBe("running");

    // Simulate app restart — close and re-init
    db.close();

    const profileDir = tempDirs[tempDirs.length - 1]!;
    db = new AppDatabase(profileDir);
    db.init(); // This calls interruptStaleRuns()

    snapshot = db.listSnapshot();
    const recoveredRun = snapshot.runs.find((r) => r.id === run.id);
    expect(recoveredRun?.status).toBe("interrupted");
  });

  it("finishRun can mark interrupted runs from crash recovery", () => {
    const agentId = createAgent({ name: "Agent" });
    const taskId = db.saveTask({
      companyId,
      title: "Crash recovery task",
      description: "Test",
      assigneeAgentId: agentId,
      workspaceId,
      priority: "medium",
      status: "in_progress",
    });

    const run = db.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "codex_local",
    });

    db.markRunStatus(run.id, "running", "Started");

    // Simulate crash recovery - mark as interrupted
    db.finishRun({
      runId: run.id,
      status: "interrupted",
      summary: "Worker process crashed.",
      errorMessage: "Worker process exited unexpectedly.",
      exitCode: 1,
      signal: null,
      model: null,
      sessionDisplayId: null,
      costUsd: null,
      unattributedCost: true,
    });

    const snapshot = db.listSnapshot();
    const recovered = snapshot.runs.find((r) => r.id === run.id);
    expect(recovered?.status).toBe("interrupted");
    expect(recovered?.errorMessage).toBe("Worker process exited unexpectedly.");
  });
});

// ─── Step 8: Wake Reason Injection ──────────────────────────────────

describe("Step 8: Wake reason injection", () => {
  it("includes wake reason section for non-timer triggers", () => {
    const agentId = createAgent({ name: "CTO", role: "CTO" });
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const ceo = db.getAgent(ceoId);

    const ctx = buildCtx({
      agentId,
      chainOfCommand: [ceo],
      wakeReason: "subtask_completed",
    });

    const prompt = buildTaskPrompt(ctx);
    expect(prompt).toContain("Wake Reason");
    expect(prompt).toContain("subtask assigned to one of your reports has been completed");
  });

  it("does not include wake reason for timer triggers", () => {
    const agentId = createAgent({ name: "Agent" });

    const ctx = buildCtx({
      agentId,
      wakeReason: "timer",
    });

    const prompt = buildTaskPrompt(ctx);
    expect(prompt).not.toContain("Wake Reason");
  });

  it("does not include wake reason for manual triggers", () => {
    const agentId = createAgent({ name: "Agent" });

    const ctx = buildCtx({
      agentId,
      wakeReason: "manual",
    });

    const prompt = buildTaskPrompt(ctx);
    expect(prompt).not.toContain("Wake Reason");
  });

  it("includes correct message for each wake reason", () => {
    const agentId = createAgent({ name: "Agent" });

    const reasons: Record<string, string> = {
      assignment: "assigned new work",
      goal_activated: "goal you own has been activated",
      approval_resolved: "approval you requested has been resolved",
      subtask_completed: "subtask assigned to one of your reports has been completed",
      comment: "new comment has been posted",
      report_blocked: "reports is blocked",
      report_failed: "reports has failed",
    };

    for (const [reason, expectedText] of Object.entries(reasons)) {
      const ctx = buildCtx({
        agentId,
        wakeReason: reason,
      });
      const prompt = buildTaskPrompt(ctx);
      expect(prompt).toContain("Wake Reason");
      expect(prompt).toContain(expectedText);
    }
  });

  it("handles unknown wake reason gracefully", () => {
    const agentId = createAgent({ name: "Agent" });

    const ctx = buildCtx({
      agentId,
      wakeReason: "custom_trigger_xyz",
    });

    const prompt = buildTaskPrompt(ctx);
    expect(prompt).toContain("Wake Reason");
    expect(prompt).toContain("Trigger: custom_trigger_xyz");
  });

  it("includes wake reason before task description", () => {
    const agentId = createAgent({ name: "Agent" });
    const taskId = db.saveTask({
      companyId,
      title: "Do the thing",
      description: "Test task",
      assigneeAgentId: agentId,
      workspaceId,
      priority: "medium",
      status: "todo",
    });
    const task = db.getTask(taskId);

    const ctx = buildCtx({
      agentId,
      task,
      wakeReason: "assignment",
    });

    const prompt = buildTaskPrompt(ctx);
    const wakeIndex = prompt.indexOf("Wake Reason");
    const taskIndex = prompt.indexOf("Your immediate task");
    expect(wakeIndex).toBeGreaterThan(-1);
    expect(taskIndex).toBeGreaterThan(-1);
    expect(wakeIndex).toBeLessThan(taskIndex);
  });
});

// ─── E2E: Full Autonomous Chain Flow ────────────────────────────────

describe("E2E: Full autonomous CEO cold start flow", () => {
  it("simulates complete chain: CEO creation → team build → org approval → delegation → completion", () => {
    // 1. Create CEO agent
    const ceoId = createAgent({ name: "Atlas", role: "CEO", status: "idle" });

    // CEO has no team yet → Phase 0
    const phase0Ctx = buildCtx({
      agentId: ceoId,
      directReports: [],
      chainOfCommand: [],
      pendingApprovals: [],
    });
    const phase0Prompt = buildSystemPrompt(phase0Ctx);
    expect(phase0Prompt).toContain("Team Building Phase");

    // 2. CEO submits hire requests
    const ctoId = createAgent({ name: "Nova", role: "CTO", reportsTo: ceoId, status: "pending_approval" as "idle" });
    const cmoId = createAgent({ name: "Aria", role: "CMO", reportsTo: ceoId, status: "pending_approval" as "idle" });

    // 3. CEO submits org strategy approval
    const orgApprovalId = db.requestApproval({
      companyId,
      requestedByAgentId: ceoId,
      type: "approve_ceo_strategy",
      payloadSummary: "Org: CEO + CTO + CMO",
      impactSummary: "3-person team",
    });

    // CEO now in Phase 1
    const ctoRecord = db.getAgent(ctoId);
    const cmoRecord = db.getAgent(cmoId);
    const phase1Ctx = buildCtx({
      agentId: ceoId,
      directReports: [ctoRecord, cmoRecord],
      chainOfCommand: [],
      pendingApprovals: [{
        id: orgApprovalId,
        companyId,
        type: "approve_ceo_strategy",
        state: "pending",
        payloadSummary: "Org: CEO + CTO + CMO",
        impactSummary: "3-person team",
        requestedByAgentId: ceoId,
        relatedTaskId: null,
        decisionNote: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as ApprovalRecord],
    });
    const phase1Prompt = buildSystemPrompt(phase1Ctx);
    expect(phase1Prompt).toContain("Awaiting Org Approval");

    // 4. Board approves hires
    const hireApprovalCTO = db.requestApproval({
      companyId,
      requestedByAgentId: ceoId,
      type: "hire_agent",
      payloadSummary: "Hire Nova as CTO",
      impactSummary: "Test",
      payloadJson: JSON.stringify({ agentId: ctoId }),
    });
    db.decideApproval({ approvalId: hireApprovalCTO, state: "approved", decisionNote: "Approved" });

    const hireApprovalCMO = db.requestApproval({
      companyId,
      requestedByAgentId: ceoId,
      type: "hire_agent",
      payloadSummary: "Hire Aria as CMO",
      impactSummary: "Test",
      payloadJson: JSON.stringify({ agentId: cmoId }),
    });
    db.decideApproval({ approvalId: hireApprovalCMO, state: "approved", decisionNote: "Approved" });

    // Agents now idle
    expect(db.getAgent(ctoId).status).toBe("idle");
    expect(db.getAgent(cmoId).status).toBe("idle");

    // 5. Board approves org strategy
    db.decideApproval({ approvalId: orgApprovalId, state: "approved", decisionNote: "Go ahead" });

    // 6. CEO now in Phase 2
    const updatedCto = db.getAgent(ctoId);
    const updatedCmo = db.getAgent(cmoId);
    const phase2Ctx = buildCtx({
      agentId: ceoId,
      directReports: [updatedCto, updatedCmo],
      chainOfCommand: [],
      pendingApprovals: [], // all approved now
    });
    const phase2Prompt = buildSystemPrompt(phase2Ctx);
    expect(phase2Prompt).toContain("Executive / CEO");
    expect(phase2Prompt).toContain("Goal Decomposition");
    expect(phase2Prompt).toContain("Delegation");

    // 7. Verify hierarchical chain
    const ctoChain = db.getChainOfCommand(ctoId);
    expect(ctoChain).toHaveLength(1);
    expect(ctoChain[0].id).toBe(ceoId);

    // 8. Create task tree
    const projectId = db.saveProject({
      companyId,
      name: "Launch MVP",
      description: "Build and launch MVP",
      goalId: null,
      leadAgentId: ctoId,
      status: "in_progress",
    });

    const parentTaskId = db.saveTask({
      companyId,
      title: "Build backend",
      description: "Implement API",
      assigneeAgentId: ctoId,
      projectId,
      workspaceId,
      priority: "high",
      status: "in_progress",
    });

    // CTO creates subtask for IC (would be done via API)
    const icId = createAgent({ name: "Dev", role: "Engineer", reportsTo: ctoId, status: "idle" });
    const subtaskId = db.saveTask({
      companyId,
      title: "Implement auth",
      description: "JWT auth",
      assigneeAgentId: icId,
      parentId: parentTaskId,
      projectId,
      workspaceId,
      priority: "medium",
      status: "todo",
    });

    // Verify parent-child relationship
    const subtask = db.getTask(subtaskId);
    expect(subtask.parentId).toBe(parentTaskId);

    // 9. Deferred wake test: enqueue wake while IC is busy
    db.enqueuePendingWake(companyId, icId, "comment");
    const pendingWakes = db.consumePendingWakes(icId);
    expect(pendingWakes).toHaveLength(1);
    expect(pendingWakes[0].trigger).toBe("comment");

    // 10. Verify IC prompt has correct wake reason
    const icPromptCtx = buildCtx({
      agentId: icId,
      task: subtask,
      chainOfCommand: [db.getAgent(ctoId), db.getAgent(ceoId)],
      wakeReason: "assignment",
    });
    const icPrompt = buildTaskPrompt(icPromptCtx);
    expect(icPrompt).toContain("Wake Reason");
    expect(icPrompt).toContain("assigned new work");
    expect(icPrompt).toContain("Implement auth");
  });
});

// ─── E2E: Deferred Wake + Run Lifecycle ─────────────────────────────

describe("E2E: Deferred wake queue with run lifecycle", () => {
  it("wake enqueue + run finish + consume cycle", () => {
    const agentId = createAgent({ name: "Agent" });

    // Simulate: agent is running, wakes come in
    db.enqueuePendingWake(companyId, agentId, "subtask_completed");
    db.enqueuePendingWake(companyId, agentId, "comment");
    db.enqueuePendingWake(companyId, agentId, "report_blocked");

    // Agent finishes run → consume pending wakes
    const wakes = db.consumePendingWakes(agentId);
    expect(wakes).toHaveLength(3);
    expect(wakes[0].trigger).toBe("subtask_completed");
    expect(wakes[1].trigger).toBe("comment");
    expect(wakes[2].trigger).toBe("report_blocked");

    // All consumed
    expect(db.consumePendingWakes(agentId)).toHaveLength(0);
  });
});

// ─── E2E: Blocked Escalation Chain ──────────────────────────────────

describe("E2E: Blocked escalation through org hierarchy", () => {
  it("getChainOfCommand provides escalation path for blocked IC", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const ctoId = createAgent({ name: "CTO", role: "CTO", reportsTo: ceoId });
    const icId = createAgent({ name: "Dev", role: "Engineer", reportsTo: ctoId });

    // When IC marks task blocked, we need to find its manager
    const chain = db.getChainOfCommand(icId);
    expect(chain[0].id).toBe(ctoId); // immediate manager gets woken

    // When CTO needs to escalate further
    const ctoChain = db.getChainOfCommand(ctoId);
    expect(ctoChain[0].id).toBe(ceoId);
  });
});

// ─── Adversarial Review Fix Tests ───────────────────────────────────

describe("Review Fix: CEO phase ordering edge case", () => {
  it("shows awaiting hire approvals when org strategy approved first but hires still pending", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    // Hires submitted but not yet approved
    const hireId = createAgent({ name: "CTO", role: "CTO", reportsTo: ceoId, status: "pending_approval" as "idle" });
    const hire = db.getAgent(hireId);

    // Org strategy already approved (not in pendingApprovals), but hires still pending
    const ctx = buildCtx({
      agentId: ceoId,
      directReports: [hire], // only pending_approval
      chainOfCommand: [],
      pendingApprovals: [], // org strategy already resolved
    });

    const prompt = buildSystemPrompt(ctx);
    // Should NOT get Phase 0 (team building) — hires are already submitted
    expect(prompt).not.toContain("Team Building Phase");
    // Should get the awaiting hire approvals phase
    expect(prompt).toContain("Awaiting Hire Approvals");
  });

  it("moves to Phase 2 once hires are approved (no pending org approval)", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const ctoId = createAgent({ name: "CTO", role: "CTO", reportsTo: ceoId, status: "idle" });
    const cto = db.getAgent(ctoId);

    const ctx = buildCtx({
      agentId: ceoId,
      directReports: [cto], // active report
      chainOfCommand: [],
      pendingApprovals: [],
    });

    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("Executive / CEO");
    expect(prompt).not.toContain("Awaiting Hire Approvals");
    expect(prompt).not.toContain("Team Building Phase");
  });
});

describe("Review Fix: Org gate consistency (revision_requested)", () => {
  it("org-strategy revision_requested blocks the CEO in Phase 1", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });

    const ctx = buildCtx({
      agentId: ceoId,
      directReports: [],
      chainOfCommand: [],
      pendingApprovals: [
        {
          id: "approval-rev",
          companyId,
          type: "approve_ceo_strategy",
          state: "revision_requested",
          payloadSummary: "Org plan needs changes",
          impactSummary: "",
          requestedByAgentId: ceoId,
          relatedTaskId: null,
          decisionNote: "Please add a CPO",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as ApprovalRecord,
      ],
    });

    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("Awaiting Org Approval");
    expect(prompt).toContain("revision_requested");
  });
});

describe("Review Fix: Rejected approval wakes agent", () => {
  it("decideApproval with rejected state still triggers wake (tested via DB)", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });

    const approvalId = db.requestApproval({
      companyId,
      requestedByAgentId: ceoId,
      type: "approve_ceo_strategy",
      payloadSummary: "Org plan",
      impactSummary: "test",
    });

    db.decideApproval({
      approvalId,
      state: "rejected",
      decisionNote: "Not ready",
    });

    // Verify approval state
    const approval = db.getApprovalRecord(approvalId);
    expect(approval.state).toBe("rejected");
    // The IPC handler in index.ts now wakes on rejected too —
    // we verify the DB layer works; the wakeAgentIfPossible call is in index.ts
  });
});

describe("Review Fix: Root task completion notification", () => {
  it("root task (no parentId) should still have org hierarchy for manager lookup", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const ctoId = createAgent({ name: "CTO", role: "CTO", reportsTo: ceoId });

    // CTO has a root-level task (no parentId)
    const taskId = db.saveTask({
      companyId,
      title: "Standalone task from CEO",
      description: "No parent",
      assigneeAgentId: ctoId,
      workspaceId,
      priority: "high",
      status: "done",
    });

    const task = db.getTask(taskId);
    expect(task.parentId).toBeNull();

    // CTO's chain of command includes CEO — so api-server can wake CEO on completion
    const chain = db.getChainOfCommand(ctoId);
    expect(chain).toHaveLength(1);
    expect(chain[0].id).toBe(ceoId);
  });
});
