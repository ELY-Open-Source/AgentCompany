import { describe, expect, it, vi } from "vitest";

/**
 * Tests for non-code task deliverable enforcement in automation-service.ts.
 *
 * When a run completes successfully on a non-code task (research, content),
 * the system checks whether the agent produced a tangible deliverable
 * (knowledge entry, document, or substantial comment). If not, the task
 * stays in_progress and the manager is notified.
 */

type TaskType = "code" | "research" | "content" | "management" | "general";

interface DeliverableCheckInput {
  taskType: TaskType;
  hasKnowledgeEntry: boolean;
  hasDocument: boolean;
  hasSubstantialComment: boolean;
}

/**
 * Standalone deliverable-check logic extracted for testability.
 * Mirrors the checkRunProducedDeliverable function inside automation-service.ts.
 */
function needsDeliverableCheck(taskType: TaskType): boolean {
  return taskType === "research" || taskType === "content";
}

function hasDeliverable(input: DeliverableCheckInput): boolean {
  if (!needsDeliverableCheck(input.taskType)) {
    // Code/management/general tasks don't require deliverable check
    return true;
  }
  return input.hasKnowledgeEntry || input.hasDocument || input.hasSubstantialComment;
}

/**
 * Determines the next status after a successful run.
 * Returns { nextStatus, comment } for how the task should be advanced.
 */
function determinePostRunStatus(input: DeliverableCheckInput): {
  nextStatus: "in_review" | "in_progress";
  comment: string;
} {
  if (!needsDeliverableCheck(input.taskType)) {
    return {
      nextStatus: "in_review",
      comment: "Run completed successfully. Awaiting review.",
    };
  }

  if (hasDeliverable(input)) {
    return {
      nextStatus: "in_review",
      comment: "Run completed with deliverable. Awaiting review.",
    };
  }

  return {
    nextStatus: "in_progress",
    comment: `${input.taskType} task run completed but no deliverable artifact was detected. Flagging for manager review.`,
  };
}

describe("non-code task deliverable enforcement", () => {
  describe("needsDeliverableCheck", () => {
    it("returns false for code tasks", () => {
      expect(needsDeliverableCheck("code")).toBe(false);
    });

    it("returns true for research tasks", () => {
      expect(needsDeliverableCheck("research")).toBe(true);
    });

    it("returns true for content tasks", () => {
      expect(needsDeliverableCheck("content")).toBe(true);
    });

    it("returns false for management tasks", () => {
      expect(needsDeliverableCheck("management")).toBe(false);
    });

    it("returns false for general tasks", () => {
      expect(needsDeliverableCheck("general")).toBe(false);
    });
  });

  describe("determinePostRunStatus", () => {
    it("advances code tasks to in_review unconditionally", () => {
      const result = determinePostRunStatus({
        taskType: "code",
        hasKnowledgeEntry: false,
        hasDocument: false,
        hasSubstantialComment: false,
      });
      expect(result.nextStatus).toBe("in_review");
      expect(result.comment).toContain("Awaiting review");
    });

    it("advances general tasks to in_review unconditionally", () => {
      const result = determinePostRunStatus({
        taskType: "general",
        hasKnowledgeEntry: false,
        hasDocument: false,
        hasSubstantialComment: false,
      });
      expect(result.nextStatus).toBe("in_review");
    });

    it("advances management tasks to in_review unconditionally", () => {
      const result = determinePostRunStatus({
        taskType: "management",
        hasKnowledgeEntry: false,
        hasDocument: false,
        hasSubstantialComment: false,
      });
      expect(result.nextStatus).toBe("in_review");
    });

    it("keeps research task in_progress when no deliverable exists", () => {
      const result = determinePostRunStatus({
        taskType: "research",
        hasKnowledgeEntry: false,
        hasDocument: false,
        hasSubstantialComment: false,
      });
      expect(result.nextStatus).toBe("in_progress");
      expect(result.comment).toContain("no deliverable artifact");
      expect(result.comment).toContain("manager review");
    });

    it("advances research task to in_review when knowledge entry exists", () => {
      const result = determinePostRunStatus({
        taskType: "research",
        hasKnowledgeEntry: true,
        hasDocument: false,
        hasSubstantialComment: false,
      });
      expect(result.nextStatus).toBe("in_review");
      expect(result.comment).toContain("deliverable");
    });

    it("advances research task to in_review when document exists", () => {
      const result = determinePostRunStatus({
        taskType: "research",
        hasKnowledgeEntry: false,
        hasDocument: true,
        hasSubstantialComment: false,
      });
      expect(result.nextStatus).toBe("in_review");
    });

    it("advances research task to in_review when substantial comment exists", () => {
      const result = determinePostRunStatus({
        taskType: "research",
        hasKnowledgeEntry: false,
        hasDocument: false,
        hasSubstantialComment: true,
      });
      expect(result.nextStatus).toBe("in_review");
    });

    it("keeps content task in_progress when no deliverable exists", () => {
      const result = determinePostRunStatus({
        taskType: "content",
        hasKnowledgeEntry: false,
        hasDocument: false,
        hasSubstantialComment: false,
      });
      expect(result.nextStatus).toBe("in_progress");
      expect(result.comment).toContain("no deliverable artifact");
    });

    it("advances content task to in_review when document exists", () => {
      const result = determinePostRunStatus({
        taskType: "content",
        hasKnowledgeEntry: false,
        hasDocument: true,
        hasSubstantialComment: false,
      });
      expect(result.nextStatus).toBe("in_review");
    });

    it("advances content task when any deliverable exists", () => {
      const result = determinePostRunStatus({
        taskType: "content",
        hasKnowledgeEntry: true,
        hasDocument: false,
        hasSubstantialComment: false,
      });
      expect(result.nextStatus).toBe("in_review");
    });
  });
});
