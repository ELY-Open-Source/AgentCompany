import { describe, expect, it } from "vitest";
import {
  validateTaskCreation,
  checkAcceptanceCriteria,
  checkCapabilityMatch,
  ACCEPTANCE_CRITERIA_KEYWORDS,
} from "../../src/main/task-quality-gates";
import type { TaskValidationResult as _TaskValidationResult } from "../../src/main/task-quality-gates";

// --- TASK-01: validateTaskCreation tests ---

describe("validateTaskCreation", () => {
  it("rejects description with 5 chars when not heartbeat", () => {
    const result = validateTaskCreation({ title: "Fix bug", description: "Short" });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("at least 50 characters"))).toBe(true);
  });

  it("rejects description with exactly 49 chars when not heartbeat", () => {
    const desc = "A".repeat(49);
    const result = validateTaskCreation({ title: "Fix bug", description: desc });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("at least 50 characters"))).toBe(true);
  });

  it("accepts description with exactly 50 chars and acceptance keyword when not heartbeat", () => {
    const desc = "Done when: the login page renders correctly." + "......";
    // Ensure exactly 50 chars
    const padded = desc.slice(0, 50).padEnd(50, ".");
    expect(padded.length).toBe(50);
    // Must contain "done when"
    const result = validateTaskCreation({ title: "Build login page", description: padded });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects empty description when not heartbeat", () => {
    const result = validateTaskCreation({ title: "Some task", description: "" });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("at least 50 characters"))).toBe(true);
  });

  it("rejects 60-char description without acceptance criteria keywords", () => {
    const desc = "This is a description that is long enough to pass length check";
    expect(desc.length).toBeGreaterThanOrEqual(50);
    const result = validateTaskCreation({ title: "A task", description: desc });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.toLowerCase().includes("acceptance criteria"))).toBe(true);
  });

  it("returns valid=true when description has both length and acceptance criteria", () => {
    const desc = "Implement the authentication flow for the login page. Done when: all tests pass and the form submits.";
    expect(desc.length).toBeGreaterThanOrEqual(50);
    const result = validateTaskCreation({ title: "Auth flow", description: desc });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("includes current character count in length error message", () => {
    const result = validateTaskCreation({ title: "Fix", description: "Short" });
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

  it("returns matched=false with warning when agent has empty capabilities and no skills", () => {
    const db = makeMockDb({ name: "New Agent", capabilities: "" });
    const result = checkCapabilityMatch(db, "agent-1", "Build React login form", "company-1");
    expect(result.matched).toBe(false);
    expect(result.warning).toContain("New Agent");
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
