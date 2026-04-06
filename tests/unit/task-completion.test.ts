import { describe, expect, it } from "vitest";
import {
  needsDeliverableCheck,
  determinePostRunStatus,
} from "@main/automation/automation-run-completion";

/**
 * Tests for non-code task deliverable enforcement in automation-run-completion.ts.
 *
 * When a run completes successfully on a non-code task (research, content),
 * the system checks whether the agent produced a tangible deliverable
 * (knowledge entry, document, or substantial comment). If not, the task
 * stays in_progress and the manager is notified.
 */

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
