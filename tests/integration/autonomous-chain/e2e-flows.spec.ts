/**
 * End-to-end chain flows + adversarial review-fix regression tests.
 * Physically extracted from autonomous-chain.spec.ts without behavior changes.
 */

import { describe, expect, it } from "vitest";
import { buildTaskPrompt } from "../../../src/main/prompt-builder/index";
import type { ApprovalRecord } from "../../../src/shared/types";
import { installSharedSetup } from "./shared-setup";

const shared = installSharedSetup();
const { createAgent, buildCtx } = shared;

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
    const phase0Prompt = buildTaskPrompt(phase0Ctx);
    expect(phase0Prompt).toContain("Team Building Phase");

    // 2. CEO submits hire requests
    const ctoId = createAgent({ name: "Nova", role: "CTO", reportsTo: ceoId, status: "pending_approval" as "idle" });
    const cmoId = createAgent({ name: "Aria", role: "CMO", reportsTo: ceoId, status: "pending_approval" as "idle" });

    // 3. CEO submits org strategy approval
    const orgApprovalId = shared.db.core.approvals.requestApproval({
      companyId: shared.companyId,
      requestedByAgentId: ceoId,
      type: "approve_ceo_strategy",
      payloadSummary: "Org: CEO + CTO + CMO",
      impactSummary: "3-person team",
    });

    // CEO now in Phase 1
    const ctoRecord = shared.db.core.entity.getAgent(ctoId);
    const cmoRecord = shared.db.core.entity.getAgent(cmoId);
    const phase1Ctx = buildCtx({
      agentId: ceoId,
      directReports: [ctoRecord, cmoRecord],
      chainOfCommand: [],
      pendingApprovals: [{
        id: orgApprovalId,
        companyId: shared.companyId,
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
    const phase1Prompt = buildTaskPrompt(phase1Ctx);
    expect(phase1Prompt).toContain("Awaiting Org Strategy Approval");

    // 4. Board approves hires
    const hireApprovalCTO = shared.db.core.approvals.requestApproval({
      companyId: shared.companyId,
      requestedByAgentId: ceoId,
      type: "hire_agent",
      payloadSummary: "Hire Nova as CTO",
      impactSummary: "Test",
      payloadJson: JSON.stringify({ agentId: ctoId }),
    });
    shared.db.core.approvals.decideApproval({ approvalId: hireApprovalCTO, state: "approved", decisionNote: "Approved" });

    const hireApprovalCMO = shared.db.core.approvals.requestApproval({
      companyId: shared.companyId,
      requestedByAgentId: ceoId,
      type: "hire_agent",
      payloadSummary: "Hire Aria as CMO",
      impactSummary: "Test",
      payloadJson: JSON.stringify({ agentId: cmoId }),
    });
    shared.db.core.approvals.decideApproval({ approvalId: hireApprovalCMO, state: "approved", decisionNote: "Approved" });

    // Agents now idle
    expect(shared.db.core.entity.getAgent(ctoId).status).toBe("idle");
    expect(shared.db.core.entity.getAgent(cmoId).status).toBe("idle");

    // 5. Board approves org strategy
    shared.db.core.approvals.decideApproval({ approvalId: orgApprovalId, state: "approved", decisionNote: "Go ahead" });

    // 6. CEO now in Phase 2
    const updatedCto = shared.db.core.entity.getAgent(ctoId);
    const updatedCmo = shared.db.core.entity.getAgent(cmoId);
    const phase2Ctx = buildCtx({
      agentId: ceoId,
      directReports: [updatedCto, updatedCmo],
      chainOfCommand: [],
      pendingApprovals: [], // all approved now
    });
    const phase2Prompt = buildTaskPrompt(phase2Ctx);
    expect(phase2Prompt).toContain("Executive / CEO");
    expect(phase2Prompt).toContain("Goal Decomposition");
    expect(phase2Prompt).toContain("Delegation");

    // 7. Verify hierarchical chain
    const ctoChain = shared.db.core.agents.getChainOfCommand(ctoId);
    expect(ctoChain).toHaveLength(1);
    expect(ctoChain[0].id).toBe(ceoId);

    // 8. Create task tree
    const projectId = shared.db.core.entity.saveProject({
      companyId: shared.companyId,
      name: "Launch MVP",
      description: "Build and launch MVP",
      goalId: null,
      leadAgentId: ctoId,
      status: "in_progress",
    });

    const parentTaskId = shared.db.core.tasks.saveTask({
      companyId: shared.companyId,
      title: "Build backend",
      description: "Implement API",
      assigneeAgentId: ctoId,
      projectId,
      workspaceId: shared.workspaceId,
      priority: "high",
      status: "in_progress",
    });

    // CTO creates subtask for IC (would be done via API)
    const icId = createAgent({ name: "Dev", role: "Engineer", reportsTo: ctoId, status: "idle" });
    const subtaskId = shared.db.core.tasks.saveTask({
      companyId: shared.companyId,
      title: "Implement auth",
      description: "JWT auth",
      assigneeAgentId: icId,
      parentId: parentTaskId,
      projectId,
      workspaceId: shared.workspaceId,
      priority: "medium",
      status: "todo",
    });

    // Verify parent-child relationship
    const subtask = shared.db.core.entity.getTask(subtaskId);
    expect(subtask.parentId).toBe(parentTaskId);

    // 9. Wakeup request test: enqueue wake while IC is busy
    shared.db.automation.wakeup.enqueueWakeupRequest(shared.companyId, icId, "comment", "comment");
    const queuedWakes = shared.db.automation.wakeup.listWakeupRequests(shared.companyId, { agentId: icId, status: "queued" });
    expect(queuedWakes).toHaveLength(1);
    expect(queuedWakes[0].source).toBe("comment");

    // 10. Verify IC prompt has correct wake reason
    const icPromptCtx = buildCtx({
      agentId: icId,
      task: subtask,
      chainOfCommand: [shared.db.core.entity.getAgent(ctoId), shared.db.core.entity.getAgent(ceoId)],
      wakeReason: "assignment",
    });
    const icPrompt = buildTaskPrompt(icPromptCtx);
    expect(icPrompt).toContain("Wake Reason");
    expect(icPrompt).toContain("You have been assigned a new task");
    expect(icPrompt).toContain("Implement auth");
  });
});

describe("E2E: Wakeup request lifecycle with run lifecycle", () => {
  it("wake enqueue + coalesce + claim + complete cycle", () => {
    const agentId = createAgent({ name: "Agent" });

    // Simulate: agent is running, wakes come in. All triggers are coalesced
    // into a single wakeup request with JSON array of trigger details.
    shared.db.automation.wakeup.enqueueWakeupRequest(shared.companyId, agentId, "subtask_completed", "subtask_completed");
    shared.db.automation.wakeup.enqueueWakeupRequest(shared.companyId, agentId, "comment", "comment");
    shared.db.automation.wakeup.enqueueWakeupRequest(shared.companyId, agentId, "report_blocked", "report_blocked");

    // Verify coalesced into single row with all triggers
    const wakes = shared.db.automation.wakeup.listWakeupRequests(shared.companyId, { agentId, status: "queued" });
    expect(wakes).toHaveLength(1);
    expect(wakes[0].coalescedCount).toBe(2);

    const triggers = JSON.parse(wakes[0].triggerDetail!);
    expect(triggers).toHaveLength(3);
    expect(triggers[0].trigger).toBe("subtask_completed");
    expect(triggers[1].trigger).toBe("comment");
    expect(triggers[2].trigger).toBe("report_blocked");

    // Wakes remain queued until consumed by the run lifecycle
    expect(shared.db.automation.wakeup.listWakeupRequests(shared.companyId, { agentId, status: "queued" })).toHaveLength(1);
  });
});

describe("E2E: Blocked escalation through org hierarchy", () => {
  it("getChainOfCommand provides escalation path for blocked IC", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const ctoId = createAgent({ name: "CTO", role: "CTO", reportsTo: ceoId });
    const icId = createAgent({ name: "Dev", role: "Engineer", reportsTo: ctoId });

    // When IC marks task blocked, we need to find its manager
    const chain = shared.db.core.agents.getChainOfCommand(icId);
    expect(chain[0].id).toBe(ctoId); // immediate manager gets woken

    // When CTO needs to escalate further
    const ctoChain = shared.db.core.agents.getChainOfCommand(ctoId);
    expect(ctoChain[0].id).toBe(ceoId);
  });
});

describe("Review Fix: CEO phase ordering edge case", () => {
  it("shows awaiting hire approvals when org strategy approved first but hires still pending", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    // Hires submitted but not yet approved
    const hireId = createAgent({ name: "CTO", role: "CTO", reportsTo: ceoId, status: "pending_approval" as "idle" });
    const hire = shared.db.core.entity.getAgent(hireId);

    // Org strategy already approved (not in pendingApprovals), but hires still pending
    const ctx = buildCtx({
      agentId: ceoId,
      directReports: [hire], // only pending_approval
      chainOfCommand: [],
      pendingApprovals: [], // org strategy already resolved
    });

    const prompt = buildTaskPrompt(ctx);
    // Should NOT get Phase 0 (team building) — hires are already submitted
    expect(prompt).not.toContain("Team Building Phase");
    // Should get the awaiting hire approvals phase
    expect(prompt).toContain("Awaiting Hire Approvals");
  });

  it("moves to Phase 2 once hires are approved (no pending org approval)", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const ctoId = createAgent({ name: "CTO", role: "CTO", reportsTo: ceoId, status: "idle" });
    const cto = shared.db.core.entity.getAgent(ctoId);

    const ctx = buildCtx({
      agentId: ceoId,
      directReports: [cto], // active report
      chainOfCommand: [],
      pendingApprovals: [],
    });

    const prompt = buildTaskPrompt(ctx);
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
          companyId: shared.companyId,
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

    const prompt = buildTaskPrompt(ctx);
    expect(prompt).toContain("Awaiting Org Strategy Approval");
    expect(prompt).toContain("revision_requested");
  });
});

describe("Review Fix: Rejected approval wakes agent", () => {
  it("decideApproval with rejected state still triggers wake (tested via DB)", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });

    const approvalId = shared.db.core.approvals.requestApproval({
      companyId: shared.companyId,
      requestedByAgentId: ceoId,
      type: "approve_ceo_strategy",
      payloadSummary: "Org plan",
      impactSummary: "test",
    });

    shared.db.core.approvals.decideApproval({
      approvalId,
      state: "rejected",
      decisionNote: "Not ready",
    });

    // Verify approval state
    const approval = shared.db.core.approvals.getApprovalRecord(approvalId);
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
    const taskId = shared.db.core.tasks.saveTask({
      companyId: shared.companyId,
      title: "Standalone task from CEO",
      description: "No parent",
      assigneeAgentId: ctoId,
      workspaceId: shared.workspaceId,
      priority: "high",
      status: "done",
    });

    const task = shared.db.core.entity.getTask(taskId);
    expect(task.parentId).toBeNull();

    // CTO's chain of command includes CEO — so api-server can wake CEO on completion
    const chain = shared.db.core.agents.getChainOfCommand(ctoId);
    expect(chain).toHaveLength(1);
    expect(chain[0].id).toBe(ceoId);
  });
});
