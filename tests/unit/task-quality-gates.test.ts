import { describe, expect, it, vi } from "vitest";
import {
  validateTaskCreation,
  checkAcceptanceCriteria,
  checkCapabilityMatch,
  ACCEPTANCE_CRITERIA_KEYWORDS,
  sweepStaleReviews,
  REVIEW_TIMEOUT_MS,
} from "../../src/main/task-quality-gates";
import type {
  TaskValidationResult,
  SweepStaleReviewsDeps,
} from "../../src/main/task-quality-gates";

// --- TASK-01: validateTaskCreation tests ---

describe("validateTaskCreation", () => {
  it("rejects description with 5 chars when not heartbeat", () => {
    const result = validateTaskCreation({ title: "Fix bug", description: "Short" }, false);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("at least 50 characters"))).toBe(true);
  });

  it("rejects description with exactly 49 chars when not heartbeat", () => {
    const desc = "A".repeat(49);
    const result = validateTaskCreation({ title: "Fix bug", description: desc }, false);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("at least 50 characters"))).toBe(true);
  });

  it("accepts description with exactly 50 chars and acceptance keyword when not heartbeat", () => {
    const desc = "Done when: the login page renders correctly." + "......";
    // Ensure exactly 50 chars
    const padded = desc.slice(0, 50).padEnd(50, ".");
    expect(padded.length).toBe(50);
    // Must contain "done when"
    const result = validateTaskCreation({ title: "Build login page", description: padded }, false);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("always returns valid for heartbeat tasks regardless of description", () => {
    const result = validateTaskCreation({ title: "[Heartbeat] Check status", description: "Short" }, true);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("rejects empty description when not heartbeat", () => {
    const result = validateTaskCreation({ title: "Some task", description: "" }, false);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("at least 50 characters"))).toBe(true);
  });

  it("rejects 60-char description without acceptance criteria keywords", () => {
    const desc = "This is a description that is long enough to pass length check";
    expect(desc.length).toBeGreaterThanOrEqual(50);
    const result = validateTaskCreation({ title: "A task", description: desc }, false);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.toLowerCase().includes("acceptance criteria"))).toBe(true);
  });

  it("returns valid=true when description has both length and acceptance criteria", () => {
    const desc = "Implement the authentication flow for the login page. Done when: all tests pass and the form submits.";
    expect(desc.length).toBeGreaterThanOrEqual(50);
    const result = validateTaskCreation({ title: "Auth flow", description: desc }, false);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("includes current character count in length error message", () => {
    const result = validateTaskCreation({ title: "Fix", description: "Short" }, false);
    expect(result.errors.some(e => e.includes("currently 5"))).toBe(true);
  });
});

// --- TASK-02: checkAcceptanceCriteria tests ---

describe("checkAcceptanceCriteria", () => {
  it("detects 'done when' keyword", () => {
    const result = checkAcceptanceCriteria("This task is done when all tests pass and deployment succeeds");
    expect(result.hasCriteria).toBe(true);
  });

  it("detects 'Acceptance Criteria:' case insensitive", () => {
    const result = checkAcceptanceCriteria("Acceptance Criteria: the form validates all fields correctly");
    expect(result.hasCriteria).toBe(true);
  });

  it("detects '- [ ] first item' checkbox", () => {
    const result = checkAcceptanceCriteria("Tasks to complete:\n- [ ] first item\n- [ ] second item");
    expect(result.hasCriteria).toBe(true);
  });

  it("detects '- [x] completed item' checked checkbox", () => {
    const result = checkAcceptanceCriteria("Progress:\n- [x] completed item\n- [ ] pending item");
    expect(result.hasCriteria).toBe(true);
  });

  it("detects 'must:' keyword", () => {
    const result = checkAcceptanceCriteria("The implementation must: handle all edge cases gracefully");
    expect(result.hasCriteria).toBe(true);
  });

  it("detects 'requirements:' keyword", () => {
    const result = checkAcceptanceCriteria("Technical requirements: use React 19 with TypeScript strict");
    expect(result.hasCriteria).toBe(true);
  });

  it("detects 'success criteria' keyword", () => {
    const result = checkAcceptanceCriteria("Success criteria for this task include passing all tests");
    expect(result.hasCriteria).toBe(true);
  });

  it("detects 'deliverable:' keyword", () => {
    const result = checkAcceptanceCriteria("Primary deliverable: a working API endpoint with docs");
    expect(result.hasCriteria).toBe(true);
  });

  it("detects 'expected outcome' keyword", () => {
    const result = checkAcceptanceCriteria("Expected outcome is a fully tested authentication module");
    expect(result.hasCriteria).toBe(true);
  });

  it("detects 'exit criteria' keyword", () => {
    const result = checkAcceptanceCriteria("Exit criteria for this sprint includes shipped feature");
    expect(result.hasCriteria).toBe(true);
  });

  it("returns hasCriteria=false with suggestion for description with no keywords", () => {
    const result = checkAcceptanceCriteria("Build a login page with email and password fields");
    expect(result.hasCriteria).toBe(false);
    expect(result.suggestion).toContain("Done when:");
  });
});

// --- Verify ACCEPTANCE_CRITERIA_KEYWORDS constant ---

describe("ACCEPTANCE_CRITERIA_KEYWORDS", () => {
  it("contains all required keywords", () => {
    const required = [
      "acceptance criteria",
      "done when",
      "success criteria",
      "definition of done",
      "requirements:",
      "must:",
      "should:",
      "- [ ]",
      "- [x]",
      "deliverable:",
      "expected outcome",
      "exit criteria",
    ];
    for (const kw of required) {
      expect(ACCEPTANCE_CRITERIA_KEYWORDS).toContain(kw);
    }
  });
});

// --- TASK-03: checkCapabilityMatch tests ---

describe("checkCapabilityMatch", () => {
  function makeMockDb(agent: { name: string; capabilities: string }, skillAssignments: string[] = [], skills: Record<string, { name: string; description: string | null; slug: string }> = {}) {
    return {
      getAgent: (_id: string) => agent,
      listAgentSkillAssignments: (_id: string) => skillAssignments,
      getCompanySkill: (_companyId: string, skillId: string) => skills[skillId] ?? null,
    };
  }

  it("returns matched=true when agent capabilities overlap with task", () => {
    const db = makeMockDb({ name: "Frontend Dev", capabilities: "javascript react frontend" });
    const result = checkCapabilityMatch(db, "agent-1", "Build React login form with validation", "company-1");
    expect(result.matched).toBe(true);
  });

  it("returns matched=false with warning when capabilities do not overlap", () => {
    const db = makeMockDb({ name: "Data Analyst", capabilities: "python data analysis" });
    const result = checkCapabilityMatch(db, "agent-1", "Build React login form with validation", "company-1");
    expect(result.matched).toBe(false);
    expect(result.warning).toBeDefined();
    expect(result.warning).toContain("Data Analyst");
  });

  it("returns matched=true when agent has empty capabilities and no skills (graceful degradation)", () => {
    const db = makeMockDb({ name: "New Agent", capabilities: "" });
    const result = checkCapabilityMatch(db, "agent-1", "Build React login form", "company-1");
    expect(result.matched).toBe(true);
  });

  it("returns matched=true when agent has no capabilities but skill name overlaps with task", () => {
    const db = makeMockDb(
      { name: "Specialist", capabilities: "" },
      ["skill-1"],
      { "skill-1": { name: "react development", description: "Building React components", slug: "react-dev" } },
    );
    const result = checkCapabilityMatch(db, "agent-1", "Build React component with hooks", "company-1");
    expect(result.matched).toBe(true);
  });

  it("returns matched=true when task description has no significant words", () => {
    const db = makeMockDb({ name: "Agent", capabilities: "python" });
    const result = checkCapabilityMatch(db, "agent-1", "Do it", "company-1");
    // "do" and "it" are <= 3 chars, so taskWords is empty -> matched=true
    expect(result.matched).toBe(true);
  });
});

// --- TASK-04: sweepStaleReviews tests ---

describe("sweepStaleReviews", () => {
  const NOW = Date.now();
  const THIRTY_FIVE_MIN_AGO = new Date(NOW - 35 * 60 * 1000).toISOString();
  const TWENTY_FIVE_MIN_AGO = new Date(NOW - 25 * 60 * 1000).toISOString();

  function makeSweepDeps(overrides: Partial<SweepStaleReviewsDeps> = {}): SweepStaleReviewsDeps {
    return {
      db: {
        queryAll: vi.fn().mockReturnValue([]),
        getManagerForAgent: vi.fn().mockReturnValue(null),
        getChainOfCommand: vi.fn().mockReturnValue([]),
        advanceTaskStatus: vi.fn().mockReturnValue({ previousStatus: "in_review" }),
      },
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

  it("escalates to manager's manager when task in_review for 35 minutes", () => {
    const deps = makeSweepDeps();
    const dbMock = deps.db as unknown as { queryAll: ReturnType<typeof vi.fn>; getManagerForAgent: ReturnType<typeof vi.fn>; getChainOfCommand: ReturnType<typeof vi.fn> };

    // Task in review for 35 min
    dbMock.queryAll.mockReturnValueOnce([
      { id: "task-1", assigneeAgentId: "agent-1", updatedAt: THIRTY_FIVE_MIN_AGO, title: "Build login" },
    ]);
    // Direct manager of the assignee (the reviewer)
    dbMock.getManagerForAgent.mockReturnValueOnce({ id: "manager-1", name: "Manager One", companyId: "company-1" });
    // Chain of command for the reviewer — the reviewer's manager (escalation target)
    dbMock.getChainOfCommand.mockReturnValueOnce([{ id: "higher-manager-1", name: "Higher Manager" }]);

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

  it("does not escalate when task in_review for only 25 minutes (under threshold)", () => {
    const deps = makeSweepDeps();
    const dbMock = deps.db as unknown as { queryAll: ReturnType<typeof vi.fn> };

    dbMock.queryAll.mockReturnValueOnce([
      { id: "task-1", assigneeAgentId: "agent-1", updatedAt: TWENTY_FIVE_MIN_AGO, title: "Build login" },
    ]);

    const count = sweepStaleReviews("company-1", deps, NOW);
    expect(count).toBe(0);
    expect(deps.dispatchAgentMessage).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it("notifies human when no higher manager (reviewer is CEO)", () => {
    const deps = makeSweepDeps();
    const dbMock = deps.db as unknown as { queryAll: ReturnType<typeof vi.fn>; getManagerForAgent: ReturnType<typeof vi.fn>; getChainOfCommand: ReturnType<typeof vi.fn> };

    dbMock.queryAll
      .mockReturnValueOnce([
        { id: "task-1", assigneeAgentId: "agent-1", updatedAt: THIRTY_FIVE_MIN_AGO, title: "Build login" },
      ])
      .mockReturnValueOnce([]); // no pending approvals
    dbMock.getManagerForAgent.mockReturnValueOnce({ id: "ceo-1", name: "CEO", companyId: "company-1" });
    // Empty chain means reviewer is the top of hierarchy
    dbMock.getChainOfCommand.mockReturnValueOnce([]);

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

  it("auto-approves pending approval linked to stale review task", () => {
    const deps = makeSweepDeps();
    const dbMock = deps.db as unknown as { queryAll: ReturnType<typeof vi.fn>; getManagerForAgent: ReturnType<typeof vi.fn>; getChainOfCommand: ReturnType<typeof vi.fn> };

    // First queryAll: stale task
    dbMock.queryAll.mockReturnValueOnce([
      { id: "task-1", assigneeAgentId: "agent-1", updatedAt: THIRTY_FIVE_MIN_AGO, title: "Build login" },
    ]);
    dbMock.getManagerForAgent.mockReturnValueOnce({ id: "manager-1", name: "Manager", companyId: "company-1" });
    dbMock.getChainOfCommand.mockReturnValueOnce([{ id: "higher-1", name: "Higher" }]);
    // Second queryAll: pending approval
    dbMock.queryAll.mockReturnValueOnce([{ id: "approval-1" }]);

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

  it("catches resolveApprovalDecision error gracefully (race condition)", () => {
    const deps = makeSweepDeps();
    const dbMock = deps.db as unknown as { queryAll: ReturnType<typeof vi.fn>; getManagerForAgent: ReturnType<typeof vi.fn>; getChainOfCommand: ReturnType<typeof vi.fn> };

    dbMock.queryAll.mockReturnValueOnce([
      { id: "task-1", assigneeAgentId: "agent-1", updatedAt: THIRTY_FIVE_MIN_AGO, title: "Build login" },
    ]);
    dbMock.getManagerForAgent.mockReturnValueOnce({ id: "manager-1", name: "Manager", companyId: "company-1" });
    dbMock.getChainOfCommand.mockReturnValueOnce([{ id: "higher-1", name: "Higher" }]);
    dbMock.queryAll.mockReturnValueOnce([{ id: "approval-1" }]);

    // resolveApprovalDecision throws (already decided)
    (deps.resolveApprovalDecision as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("Approval already decided");
    });

    // Should not throw
    expect(() => sweepStaleReviews("company-1", deps, NOW)).not.toThrow();
  });

  it("advances task status to done after escalation", () => {
    const deps = makeSweepDeps();
    const dbMock = deps.db as unknown as { queryAll: ReturnType<typeof vi.fn>; getManagerForAgent: ReturnType<typeof vi.fn>; getChainOfCommand: ReturnType<typeof vi.fn>; advanceTaskStatus: ReturnType<typeof vi.fn> };

    dbMock.queryAll.mockReturnValueOnce([
      { id: "task-1", assigneeAgentId: "agent-1", updatedAt: THIRTY_FIVE_MIN_AGO, title: "Build login" },
    ]);
    dbMock.getManagerForAgent.mockReturnValueOnce({ id: "manager-1", name: "Manager", companyId: "company-1" });
    dbMock.getChainOfCommand.mockReturnValueOnce([{ id: "higher-1", name: "Higher" }]);
    dbMock.queryAll.mockReturnValueOnce([]); // no approvals

    sweepStaleReviews("company-1", deps, NOW);

    expect(dbMock.advanceTaskStatus).toHaveBeenCalledWith(
      "task-1",
      "done",
      "Auto-advanced: review timeout exceeded 30 minutes.",
    );
    expect(deps.handleTaskStatusChange).toHaveBeenCalledWith("task-1", "company-1", "in_review", "done");
  });

  it("skips task with no assigneeAgentId", () => {
    const deps = makeSweepDeps();
    const dbMock = deps.db as unknown as { queryAll: ReturnType<typeof vi.fn> };

    dbMock.queryAll.mockReturnValueOnce([
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
});
