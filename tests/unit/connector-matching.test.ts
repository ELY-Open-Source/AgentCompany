import { describe, expect, it } from "vitest";
import {
  inferTaskType,
  getConnectorStrengths,
  TASK_TYPE_PREFERENCE,
  CONNECTOR_STRENGTHS as _CONNECTOR_STRENGTHS,
  ROLE_DEPARTMENT_HINTS as _ROLE_DEPARTMENT_HINTS,
} from "../../src/main/connector-matching";

describe("connector-matching", () => {
  describe("TASK_TYPE_PREFERENCE", () => {
    it("maps code tasks to claude_local first", () => {
      expect(TASK_TYPE_PREFERENCE.code[0]).toBe("claude_local");
    });

    it("maps research tasks to gemini_local first", () => {
      expect(TASK_TYPE_PREFERENCE.research[0]).toBe("gemini_local");
    });

    it("maps content tasks to claude_local first", () => {
      expect(TASK_TYPE_PREFERENCE.content[0]).toBe("claude_local");
    });

    it("maps management tasks to claude_local first", () => {
      expect(TASK_TYPE_PREFERENCE.management[0]).toBe("claude_local");
    });

    it("maps general tasks to claude_local first", () => {
      expect(TASK_TYPE_PREFERENCE.general[0]).toBe("claude_local");
    });

    it("includes all three core connectors for every task type", () => {
      for (const key of Object.keys(TASK_TYPE_PREFERENCE)) {
        const prefs = TASK_TYPE_PREFERENCE[key as keyof typeof TASK_TYPE_PREFERENCE];
        expect(prefs).toContain("claude_local");
        expect(prefs).toContain("codex_local");
        expect(prefs).toContain("gemini_local");
      }
    });
  });

  describe("inferTaskType", () => {
    it("returns code for engineering department", () => {
      expect(inferTaskType("engineering")).toBe("code");
    });

    it("returns research for research department", () => {
      expect(inferTaskType("research")).toBe("research");
    });

    it("returns content for marketing department", () => {
      expect(inferTaskType("marketing")).toBe("content");
    });

    it("returns content for product department", () => {
      expect(inferTaskType("product")).toBe("content");
    });

    it("returns management for hr department", () => {
      expect(inferTaskType("hr")).toBe("management");
    });

    it("returns management for finance department", () => {
      expect(inferTaskType("finance")).toBe("management");
    });

    it("returns management for executive department", () => {
      expect(inferTaskType("executive")).toBe("management");
    });

    it("returns content for design department", () => {
      expect(inferTaskType("design")).toBe("content");
    });

    it("returns content for customer_support department", () => {
      expect(inferTaskType("customer_support")).toBe("content");
    });

    it("returns management for operations department", () => {
      expect(inferTaskType("operations")).toBe("management");
    });

    it("returns content for sales department", () => {
      expect(inferTaskType("sales")).toBe("content");
    });

    it("returns management for legal department", () => {
      expect(inferTaskType("legal")).toBe("management");
    });

    it("returns general for null department", () => {
      expect(inferTaskType(null)).toBe("general");
    });

    it("returns general for undefined department", () => {
      expect(inferTaskType(undefined)).toBe("general");
    });

    it("returns general for unknown department", () => {
      expect(inferTaskType("unknown_dept")).toBe("general");
    });
  });

  describe("getConnectorStrengths", () => {
    it("returns non-empty string for claude_local", () => {
      const result = getConnectorStrengths("claude_local");
      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(10);
    });

    it("returns non-empty string for codex_local", () => {
      const result = getConnectorStrengths("codex_local");
      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(10);
    });

    it("returns non-empty string for gemini_local", () => {
      const result = getConnectorStrengths("gemini_local");
      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(10);
    });
  });
});
