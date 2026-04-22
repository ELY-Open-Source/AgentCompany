import { describe, expect, it, vi } from "vitest";
import {
  REVIEW_TIMEOUT_MS,
  sweepStaleReviews,
} from "../../src/main/task-quality-gates";
import type { SweepStaleReviewsDeps } from "../../src/main/task-quality-gates";
import type { AppDatabase } from "../../src/main/database";

describe("sweepStaleReviews", () => {
  const NOW = Date.now();
  const THIRTY_FIVE_MIN_AGO = new Date(NOW - 35 * 60 * 1000).toISOString();
  const TWENTY_FIVE_MIN_AGO = new Date(NOW - 25 * 60 * 1000).toISOString();

  function makeSweepDeps(overrides: Partial<SweepStaleReviewsDeps> = {}): SweepStaleReviewsDeps {
    return {
      db: {
        core: {
          tasks: {
            listReviewTasksForSweep: vi.fn().mockReturnValue([]),
            advanceTaskStatus: vi.fn().mockReturnValue({ previousStatus: "in_review" }),
          },
          agents: {
            getManagerForAgent: vi.fn().mockReturnValue(null),
            getChainOfCommand: vi.fn().mockReturnValue([]),
          },
          approvals: {
            findPendingApprovalForTask: vi.fn().mockReturnValue(null),
          },
        },
      } as unknown as AppDatabase,
      getCompanyExecutionMode: vi.fn().mockReturnValue("ai_ceo"),
      dispatchAgentMessage: vi.fn().mockReturnValue({ ok: true }),
      resolveApprovalDecision: vi.fn(),
      notify: vi.fn(),
      handleTaskStatusChange: vi.fn(),
      handleApprovalResolved: vi.fn(),
      emitEvent: vi.fn(),
      publishDomainChanged: vi.fn(),
      wakeAgentIfPossible: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn() },
      ...overrides,
    };
  }

  type SweepDbMock = {
    tasks: {
      listReviewTasksForSweep: ReturnType<typeof vi.fn>;
      advanceTaskStatus: ReturnType<typeof vi.fn>;
    };
    agents: {
      getManagerForAgent: ReturnType<typeof vi.fn>;
      getChainOfCommand: ReturnType<typeof vi.fn>;
    };
    approvals: {
      findPendingApprovalForTask: ReturnType<typeof vi.fn>;
    };
  };

  it("escalates to manager's manager when task in_review for 35 minutes", () => {
    const deps = makeSweepDeps();
    const dbMock = (deps.db as unknown as { core: SweepDbMock }).core;

    dbMock.tasks.listReviewTasksForSweep.mockReturnValueOnce([
      { id: "task-1", assigneeAgentId: "agent-1", updatedAt: THIRTY_FIVE_MIN_AGO, title: "Build login" },
    ]);
    dbMock.agents.getManagerForAgent.mockReturnValueOnce({ id: "manager-1", name: "Manager One", companyId: "company-1" });
    dbMock.agents.getChainOfCommand.mockReturnValueOnce([{ id: "higher-manager-1", name: "Higher Manager" }]);

    const count = sweepStaleReviews("company-1", deps, NOW);
    expect(count).toBe(1);
    expect(deps.dispatchAgentMessage).toHaveBeenCalledWith(
      expect.objectContaining({ db: deps.db }),
      expect.objectContaining({
        companyId: "company-1",
        fromAgentId: "manager-1",
        toAgentId: "higher-manager-1",
        channel: "direct",
        priority: "urgent",
      }),
      "subtask_completed",
    );
  });

  it("does not escalate when task in_review for only 25 minutes", () => {
    const deps = makeSweepDeps();
    const dbMock = (deps.db as unknown as { core: SweepDbMock }).core;

    dbMock.tasks.listReviewTasksForSweep.mockReturnValueOnce([
      { id: "task-1", assigneeAgentId: "agent-1", updatedAt: TWENTY_FIVE_MIN_AGO, title: "Build login" },
    ]);

    const count = sweepStaleReviews("company-1", deps, NOW);
    expect(count).toBe(0);
    expect(deps.dispatchAgentMessage).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it("notifies the human when the reviewer has no higher manager", () => {
    const deps = makeSweepDeps();
    const dbMock = (deps.db as unknown as { core: SweepDbMock }).core;

    dbMock.tasks.listReviewTasksForSweep.mockReturnValueOnce([
      { id: "task-1", assigneeAgentId: "agent-1", updatedAt: THIRTY_FIVE_MIN_AGO, title: "Build login" },
    ]);
    dbMock.approvals.findPendingApprovalForTask.mockReturnValueOnce(null);
    dbMock.agents.getManagerForAgent.mockReturnValueOnce({ id: "ceo-1", name: "CEO", companyId: "company-1" });
    dbMock.agents.getChainOfCommand.mockReturnValueOnce([]);

    const count = sweepStaleReviews("company-1", deps, NOW);
    expect(count).toBe(1);
    expect(deps.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Review Timeout",
        urgency: "critical",
        batchKey: "review_escalation",
        navigation: expect.objectContaining({ section: "tasks", entityId: "task-1" }),
      }),
    );
    expect(deps.dispatchAgentMessage).not.toHaveBeenCalled();
  });

  it("auto-approves pending approval linked to a stale review task", () => {
    const deps = makeSweepDeps();
    const dbMock = (deps.db as unknown as { core: SweepDbMock }).core;

    dbMock.tasks.listReviewTasksForSweep.mockReturnValueOnce([
      { id: "task-1", assigneeAgentId: "agent-1", updatedAt: THIRTY_FIVE_MIN_AGO, title: "Build login" },
    ]);
    dbMock.agents.getManagerForAgent.mockReturnValueOnce({ id: "manager-1", name: "Manager", companyId: "company-1" });
    dbMock.agents.getChainOfCommand.mockReturnValueOnce([{ id: "higher-1", name: "Higher" }]);
    dbMock.approvals.findPendingApprovalForTask.mockReturnValueOnce({ id: "approval-1", type: "deliverable_review" });

    sweepStaleReviews("company-1", deps, NOW);

    expect(deps.resolveApprovalDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        db: deps.db,
        companyId: "company-1",
        approvalId: "approval-1",
        state: "approved",
        decisionNote: "Auto-approved: review timeout exceeded 30 minutes.",
        actor: "system",
      }),
    );
  });

  it("swallows resolveApprovalDecision races gracefully", () => {
    const deps = makeSweepDeps();
    const dbMock = (deps.db as unknown as { core: SweepDbMock }).core;

    dbMock.tasks.listReviewTasksForSweep.mockReturnValueOnce([
      { id: "task-1", assigneeAgentId: "agent-1", updatedAt: THIRTY_FIVE_MIN_AGO, title: "Build login" },
    ]);
    dbMock.agents.getManagerForAgent.mockReturnValueOnce({ id: "manager-1", name: "Manager", companyId: "company-1" });
    dbMock.agents.getChainOfCommand.mockReturnValueOnce([{ id: "higher-1", name: "Higher" }]);
    dbMock.approvals.findPendingApprovalForTask.mockReturnValueOnce({ id: "approval-1", type: "deliverable_review" });
    (deps.resolveApprovalDecision as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("Approval already decided");
    });

    expect(() => sweepStaleReviews("company-1", deps, NOW)).not.toThrow();
  });

  it("advances task status to done after escalation", () => {
    const deps = makeSweepDeps();
    const dbMock = (deps.db as unknown as { core: SweepDbMock }).core;

    dbMock.tasks.listReviewTasksForSweep.mockReturnValueOnce([
      { id: "task-1", assigneeAgentId: "agent-1", updatedAt: THIRTY_FIVE_MIN_AGO, title: "Build login" },
    ]);
    dbMock.agents.getManagerForAgent.mockReturnValueOnce({ id: "manager-1", name: "Manager", companyId: "company-1" });
    dbMock.agents.getChainOfCommand.mockReturnValueOnce([{ id: "higher-1", name: "Higher" }]);
    dbMock.approvals.findPendingApprovalForTask.mockReturnValueOnce(null);

    sweepStaleReviews("company-1", deps, NOW);

    expect(dbMock.tasks.advanceTaskStatus).toHaveBeenCalledWith(
      "task-1",
      "done",
      "Auto-advanced: review timeout exceeded 30 minutes.",
    );
    expect(deps.handleTaskStatusChange).toHaveBeenCalledWith("task-1", "company-1", "in_review", "done");
  });

  it("skips tasks without an assignee", () => {
    const deps = makeSweepDeps();
    const dbMock = (deps.db as unknown as { core: SweepDbMock }).core;

    dbMock.tasks.listReviewTasksForSweep.mockReturnValueOnce([
      { id: "task-1", assigneeAgentId: null, updatedAt: THIRTY_FIVE_MIN_AGO, title: "Orphan task" },
    ]);

    const count = sweepStaleReviews("company-1", deps, NOW);
    expect(count).toBe(0);
    expect(deps.dispatchAgentMessage).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it("exports REVIEW_TIMEOUT_MS as 30 minutes in milliseconds", () => {
    expect(REVIEW_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });

  it("does not remind before the cofounder review timeout threshold", () => {
    const deps = makeSweepDeps({
      getCompanyExecutionMode: vi.fn().mockReturnValue("ai_cofounder"),
    });
    const dbMock = (deps.db as unknown as { core: SweepDbMock }).core;

    dbMock.tasks.listReviewTasksForSweep.mockReturnValueOnce([
      { id: "task-1", assigneeAgentId: "agent-1", updatedAt: TWENTY_FIVE_MIN_AGO, title: "Review me" },
    ]);

    const count = sweepStaleReviews("company-1", deps, NOW);
    expect(count).toBe(0);
    expect(deps.notify).not.toHaveBeenCalled();
    expect(deps.resolveApprovalDecision).not.toHaveBeenCalled();
    expect(deps.dispatchAgentMessage).not.toHaveBeenCalled();
    expect(dbMock.tasks.advanceTaskStatus).not.toHaveBeenCalled();
  });

  it("sends a critical cofounder review reminder without auto-approving", () => {
    const deps = makeSweepDeps({
      getCompanyExecutionMode: vi.fn().mockReturnValue("ai_cofounder"),
    });
    const dbMock = (deps.db as unknown as { core: SweepDbMock }).core;

    dbMock.tasks.listReviewTasksForSweep.mockReturnValueOnce([
      { id: "task-1", assigneeAgentId: "agent-1", updatedAt: THIRTY_FIVE_MIN_AGO, title: "Review me" },
    ]);
    dbMock.approvals.findPendingApprovalForTask.mockReturnValueOnce({ id: "approval-1", type: "deliverable_review" });
    dbMock.agents.getManagerForAgent.mockReturnValueOnce({ id: "manager-1", name: "Manager", companyId: "company-1" });

    const count = sweepStaleReviews("company-1", deps, NOW);
    expect(count).toBe(0);
    expect(deps.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Your Review Required",
        urgency: "critical",
        batchKey: "cofounder_review_needed",
        navigation: expect.objectContaining({ section: "approvals", entityId: "approval-1" }),
      }),
    );
    expect(deps.resolveApprovalDecision).not.toHaveBeenCalled();
    expect(deps.dispatchAgentMessage).not.toHaveBeenCalled();
    expect(dbMock.tasks.advanceTaskStatus).not.toHaveBeenCalled();
  });
});
