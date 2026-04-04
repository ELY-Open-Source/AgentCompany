import { describe, it, expect } from "vitest";
import {
  TOKEN_BUDGETS,
  resolveTokenBudget,
} from "@main/skill-types";
import type {
  SkillSourceType,
  TrustLevel,
  FileInventoryEntry,
  SkillRecord,
  SkillImportResult,
  RuntimeSkillEntry,
  ManagedSkillRef,
  SkillAssignment,
  SkillUpdateStatus,
} from "@main/skill-types";

describe("skill-types", () => {
  describe("TOKEN_BUDGETS", () => {
    it("has entries for all supported adapter types", () => {
      expect(TOKEN_BUDGETS).toHaveProperty("claude_local");
      expect(TOKEN_BUDGETS).toHaveProperty("codex_local");
      expect(TOKEN_BUDGETS).toHaveProperty("gemini_local");
      expect(TOKEN_BUDGETS).toHaveProperty("claude_compatible");
    });

    it("has numeric token caps for each adapter", () => {
      expect(TOKEN_BUDGETS.claude_local).toBe(50000);
      expect(TOKEN_BUDGETS.codex_local).toBe(30000);
      expect(TOKEN_BUDGETS.gemini_local).toBe(50000);
      expect(TOKEN_BUDGETS.claude_compatible).toBe(50000);
    });
  });

  describe("resolveTokenBudget", () => {
    it("returns exact match for known adapter types", () => {
      expect(resolveTokenBudget("claude_local")).toBe(50000);
      expect(resolveTokenBudget("codex_local")).toBe(30000);
      expect(resolveTokenBudget("gemini_local")).toBe(50000);
    });

    it("resolves claude_compat_* variants to claude_compatible budget", () => {
      expect(resolveTokenBudget("claude_compat_2")).toBe(50000);
      expect(resolveTokenBudget("claude_compat_10")).toBe(50000);
      expect(resolveTokenBudget("claude_compatible")).toBe(50000);
    });

    it("returns 30000 default for unknown adapter types", () => {
      expect(resolveTokenBudget("unknown_adapter")).toBe(30000);
    });
  });

  describe("type shape checks", () => {
    it("SkillSourceType accepts all five source kinds", () => {
      const sources: SkillSourceType[] = [
        "github",
        "local_path",
        "url",
        "skills_sh",
        "managed",
      ];
      expect(sources).toHaveLength(5);
    });

    it("TrustLevel accepts all three levels", () => {
      const levels: TrustLevel[] = [
        "markdown_only",
        "assets",
        "scripts_executables",
      ];
      expect(levels).toHaveLength(3);
    });

    it("FileInventoryEntry has path and kind", () => {
      const entry: FileInventoryEntry = { path: "SKILL.md", kind: "skill" };
      expect(entry.path).toBe("SKILL.md");
      expect(entry.kind).toBe("skill");
    });

    it("FileInventoryEntry kind accepts all six values", () => {
      const kinds: FileInventoryEntry["kind"][] = [
        "skill",
        "reference",
        "script",
        "asset",
        "markdown",
        "other",
      ];
      expect(kinds).toHaveLength(6);
    });

    it("SkillRecord has all expected properties", () => {
      const record: SkillRecord = {
        id: "test-id",
        companyId: "company-1",
        key: "owner/repo/slug",
        slug: "slug",
        name: "Test Skill",
        description: null,
        markdown: "# Test",
        sourceType: "github",
        sourceLocator: "https://github.com/owner/repo",
        sourceRef: "abc123",
        trustLevel: "markdown_only",
        compatibility: "compatible",
        fileInventory: [],
        metadata: null,
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
      };
      expect(record.id).toBe("test-id");
      expect(record.companyId).toBe("company-1");
    });

    it("SkillImportResult has skillId, key, name, isUpdate", () => {
      const result: SkillImportResult = {
        skillId: "id-1",
        key: "owner/repo/slug",
        name: "Test",
        isUpdate: false,
      };
      expect(result.isUpdate).toBe(false);
    });

    it("RuntimeSkillEntry has runtimeName, sourcePath, name, tokenEstimate and semantics", () => {
      const entry: RuntimeSkillEntry = {
        runtimeName: "claude",
        sourcePath: "/path/to/skill",
        name: "test-skill",
        tokenEstimate: 1000,
        allowedTools: ["read", "write"],
        hooks: ["on_task_start"],
        contextMode: "inline",
        isAgent: false,
        effort: "medium",
        whenToUse: "when writing code",
      };
      expect(entry.tokenEstimate).toBe(1000);
      expect(entry.allowedTools).toEqual(["read", "write"]);
      expect(entry.contextMode).toBe("inline");
    });

    it("ManagedSkillRef has runtimeName and sourcePath only", () => {
      const ref: ManagedSkillRef = {
        runtimeName: "claude",
        sourcePath: "/path/to/skill",
      };
      expect(ref.runtimeName).toBe("claude");
      expect(ref.sourcePath).toBe("/path/to/skill");
    });

    it("SkillAssignment has agentId and skillId", () => {
      const assignment: SkillAssignment = {
        agentId: "agent-1",
        skillId: "skill-1",
      };
      expect(assignment.agentId).toBe("agent-1");
    });

    it("SkillUpdateStatus has all expected fields", () => {
      const status: SkillUpdateStatus = {
        skillId: "skill-1",
        key: "owner/repo/slug",
        currentRef: "abc",
        latestRef: "def",
        hasUpdate: true,
      };
      expect(status.hasUpdate).toBe(true);
    });
  });
});
