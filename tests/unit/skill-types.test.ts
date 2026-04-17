import { describe, it, expect } from "vitest";
import type {
  SkillSourceType,
  TrustLevel,
  FileInventoryEntry,
  SkillRecord,
  SkillImportResult,
  ProjectedSkill,
  SkillAssignment,
  SkillUpdateStatus,
} from "@main/skill-types";

describe("skill-types", () => {
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

    it("ProjectedSkill matches pi-coding-agent Skill projection", () => {
      const entry: ProjectedSkill = {
        name: "test-skill",
        description: "What this skill does and when to use it.",
        filePath: "/abs/path/to/test-skill/SKILL.md",
        baseDir: "/abs/path/to/test-skill",
      };
      expect(entry.name).toBe("test-skill");
      expect(entry.filePath.endsWith("SKILL.md")).toBe(true);
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
