import { describe, expect, it } from "vitest";
import {
  inferTaskType,
  getConnectorStrengths,
  TASK_TYPE_PREFERENCE,
  ROLE_DEPARTMENT_HINTS as _ROLE_DEPARTMENT_HINTS,
} from "../../src/main/connector-matching";

describe("connector-matching", () => {
  describe("TASK_TYPE_PREFERENCE", () => {
    it("maps code tasks to claude-pro first", () => {
      expect(TASK_TYPE_PREFERENCE.code[0]).toBe("claude-pro");
    });

    it("maps research tasks to google first", () => {
      expect(TASK_TYPE_PREFERENCE.research[0]).toBe("google");
    });

    it("maps content tasks to claude-pro first", () => {
      expect(TASK_TYPE_PREFERENCE.content[0]).toBe("claude-pro");
    });

    it("maps management tasks to claude-pro first", () => {
      expect(TASK_TYPE_PREFERENCE.management[0]).toBe("claude-pro");
    });

    it("maps general tasks to claude-pro first", () => {
      expect(TASK_TYPE_PREFERENCE.general[0]).toBe("claude-pro");
    });

    it("includes all three core connectors for every task type", () => {
      for (const key of Object.keys(TASK_TYPE_PREFERENCE)) {
        const prefs = TASK_TYPE_PREFERENCE[key as keyof typeof TASK_TYPE_PREFERENCE];
        expect(prefs).toContain("claude-pro");
        expect(prefs).toContain("openai-codex");
        expect(prefs).toContain("gemini-cli");
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
    it("returns non-empty string for claude-pro", () => {
      const result = getConnectorStrengths("claude-pro");
      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(10);
    });

    it("returns non-empty string for openai-codex", () => {
      const result = getConnectorStrengths("openai-codex");
      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(10);
    });

    it("returns non-empty string for gemini-cli", () => {
      const result = getConnectorStrengths("gemini-cli");
      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(10);
    });
  });
});
