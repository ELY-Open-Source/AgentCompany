import { describe, expect, it } from "vitest";
import {
  matchConnector,
  inferTaskType,
  getConnectorStrengths,
  TASK_TYPE_PREFERENCE,
  CONNECTOR_STRENGTHS,
  ROLE_DEPARTMENT_HINTS,
} from "../../src/main/connector-matching";
import type { ConnectorId, ConnectorStatus } from "@shared/types";

function makeConnector(id: ConnectorId, status: ConnectorStatus = "ready", label?: string) {
  return { id, status, label: label ?? id };
}

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

    it("includes all three connectors for every task type", () => {
      for (const key of Object.keys(TASK_TYPE_PREFERENCE)) {
        const prefs = TASK_TYPE_PREFERENCE[key as keyof typeof TASK_TYPE_PREFERENCE];
        expect(prefs).toHaveLength(3);
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

  describe("matchConnector", () => {
    const allReady = [
      makeConnector("claude_local", "ready", "Claude Code"),
      makeConnector("codex_local", "ready", "Codex"),
      makeConnector("gemini_local", "ready", "Gemini CLI"),
    ];

    it("recommends claude_local for code tasks when all ready", () => {
      const result = matchConnector({
        taskType: "code",
        agentRole: "engineer",
        agentDepartment: "engineering",
        availableConnectors: allReady,
      });
      expect(result.recommendedConnectorId).toBe("claude_local");
    });

    it("recommends gemini_local for research tasks when all ready", () => {
      const result = matchConnector({
        taskType: "research",
        agentRole: "researcher",
        agentDepartment: "research",
        availableConnectors: allReady,
      });
      expect(result.recommendedConnectorId).toBe("gemini_local");
    });

    it("recommends claude_local for content tasks when all ready", () => {
      const result = matchConnector({
        taskType: "content",
        agentRole: "marketer",
        agentDepartment: "marketing",
        availableConnectors: [
          makeConnector("claude_local", "ready", "Claude Code"),
        ],
      });
      expect(result.recommendedConnectorId).toBe("claude_local");
    });

    it("falls back when preferred connector is offline", () => {
      const result = matchConnector({
        taskType: "research",
        agentRole: "researcher",
        agentDepartment: "research",
        availableConnectors: [
          makeConnector("gemini_local", "not_installed", "Gemini CLI"),
          makeConnector("claude_local", "ready", "Claude Code"),
          makeConnector("codex_local", "ready", "Codex"),
        ],
      });
      // gemini is not ready, so should fallback to claude_local (next in research preference)
      expect(result.recommendedConnectorId).toBe("claude_local");
    });

    it("uses first available connector when none are ready", () => {
      const result = matchConnector({
        taskType: "code",
        agentRole: "engineer",
        agentDepartment: "engineering",
        availableConnectors: [
          makeConnector("claude_local", "detected", "Claude Code"),
          makeConnector("codex_local", "auth_required", "Codex"),
        ],
      });
      // None ready, should pick first available
      expect(result.recommendedConnectorId).toBe("claude_local");
    });

    it("returns claude_local as ultimate fallback with empty connector list", () => {
      const result = matchConnector({
        taskType: "code",
        agentRole: "engineer",
        agentDepartment: "engineering",
        availableConnectors: [],
      });
      expect(result.recommendedConnectorId).toBe("claude_local");
    });

    it("returns a different fallback when multiple connectors are ready", () => {
      const result = matchConnector({
        taskType: "code",
        agentRole: "engineer",
        agentDepartment: "engineering",
        availableConnectors: allReady,
      });
      expect(result.fallbackConnectorId).not.toBeNull();
      expect(result.fallbackConnectorId).not.toBe(result.recommendedConnectorId);
    });

    it("returns null fallback when only one connector is ready", () => {
      const result = matchConnector({
        taskType: "code",
        agentRole: "engineer",
        agentDepartment: "engineering",
        availableConnectors: [
          makeConnector("claude_local", "ready", "Claude Code"),
          makeConnector("codex_local", "not_installed", "Codex"),
        ],
      });
      expect(result.fallbackConnectorId).toBeNull();
    });

    it("includes a descriptive reason string", () => {
      const result = matchConnector({
        taskType: "code",
        agentRole: "engineer",
        agentDepartment: "engineering",
        availableConnectors: allReady,
      });
      expect(result.reason).toBeTruthy();
      expect(typeof result.reason).toBe("string");
      expect(result.reason.length).toBeGreaterThan(5);
    });

    it("handles degraded connectors as non-ready", () => {
      const result = matchConnector({
        taskType: "research",
        agentRole: "analyst",
        agentDepartment: "research",
        availableConnectors: [
          makeConnector("gemini_local", "degraded", "Gemini CLI"),
          makeConnector("claude_local", "ready", "Claude Code"),
        ],
      });
      // gemini is degraded, should skip to claude_local
      expect(result.recommendedConnectorId).toBe("claude_local");
    });
  });
});
