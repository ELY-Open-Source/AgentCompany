import { describe, it, expect } from "vitest";
import {
  deriveCanonicalSkillKey,
  normalizeSkillSlug,
  hashSkillValue,
  parseSkillImportSource,
} from "@main/skill-keys";

describe("skill-keys", () => {
  describe("normalizeSkillSlug", () => {
    it("lowercases and replaces non-alphanumeric with hyphens", () => {
      expect(normalizeSkillSlug("Hello World!")).toBe("hello-world");
    });

    it("returns null for undefined", () => {
      expect(normalizeSkillSlug(undefined)).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(normalizeSkillSlug("")).toBeNull();
    });

    it("returns null for null", () => {
      expect(normalizeSkillSlug(null)).toBeNull();
    });

    it("trims leading and trailing hyphens", () => {
      expect(normalizeSkillSlug("--hello--")).toBe("hello");
    });

    it("collapses consecutive non-alphanumeric chars", () => {
      expect(normalizeSkillSlug("a  b  c")).toBe("a-b-c");
    });

    it("returns null for string that becomes empty", () => {
      expect(normalizeSkillSlug("!!!")).toBeNull();
    });

    it("handles already-normalized slugs", () => {
      expect(normalizeSkillSlug("code-review")).toBe("code-review");
    });
  });

  describe("hashSkillValue", () => {
    it("returns first 10 chars of SHA-256 hex digest", () => {
      const hash = hashSkillValue("test-value");
      expect(hash).toHaveLength(10);
      expect(hash).toMatch(/^[0-9a-f]{10}$/);
    });

    it("produces deterministic output", () => {
      const hash1 = hashSkillValue("same-input");
      const hash2 = hashSkillValue("same-input");
      expect(hash1).toBe(hash2);
    });

    it("produces different output for different inputs", () => {
      const hash1 = hashSkillValue("input-a");
      const hash2 = hashSkillValue("input-b");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("deriveCanonicalSkillKey", () => {
    it("returns owner/repo/slug for GitHub source with metadata", () => {
      const result = deriveCanonicalSkillKey("company-1", {
        slug: "code-review",
        sourceType: "github",
        sourceLocator: "https://github.com/anthropics/skills",
        metadata: { owner: "anthropics", repo: "skills" },
      });
      expect(result).toBe("anthropics/skills/code-review");
    });

    it("returns url/host/hash/slug for URL source", () => {
      const result = deriveCanonicalSkillKey("company-1", {
        slug: "my-skill",
        sourceType: "url",
        sourceLocator: "https://example.com/skill.md",
        metadata: null,
      });
      expect(result).toMatch(/^url\/example-com\/[0-9a-f]{10}\/my-skill$/);
    });

    it("returns local/hash/slug for local_path source", () => {
      const result = deriveCanonicalSkillKey("company-1", {
        slug: "review",
        sourceType: "local_path",
        sourceLocator: "/home/user/skills/review",
        metadata: null,
      });
      expect(result).toMatch(/^local\/[0-9a-f]{10}\/review$/);
    });

    it("returns same format as GitHub for skills_sh source with owner/repo", () => {
      const result = deriveCanonicalSkillKey("company-1", {
        slug: "lint",
        sourceType: "skills_sh",
        sourceLocator: null,
        metadata: { owner: "anthropics", repo: "skills" },
      });
      expect(result).toBe("anthropics/skills/lint");
    });

    it("returns company/companyId/slug as fallback", () => {
      const result = deriveCanonicalSkillKey("company-1", {
        slug: "custom",
        sourceType: "managed",
        sourceLocator: null,
        metadata: null,
      });
      expect(result).toBe("company/company-1/custom");
    });

    it("defaults slug to skill when null-like", () => {
      const result = deriveCanonicalSkillKey("company-1", {
        slug: "",
        sourceType: "managed",
        sourceLocator: null,
        metadata: null,
      });
      expect(result).toBe("company/company-1/skill");
    });
  });

  describe("parseSkillImportSource", () => {
    it("parses three-part key as GitHub with skills.sh origin", () => {
      const result = parseSkillImportSource("owner/repo/skill");
      expect(result.resolvedSource).toBe("https://github.com/owner/repo");
      expect(result.requestedSkillSlug).toBe("skill");
      expect(result.originalSkillsShUrl).toBe(
        "https://skills.sh/owner/repo/skill",
      );
    });

    it("parses two-part key as GitHub", () => {
      const result = parseSkillImportSource("owner/repo");
      expect(result.resolvedSource).toBe("https://github.com/owner/repo");
      expect(result.requestedSkillSlug).toBeNull();
      expect(result.originalSkillsShUrl).toBeNull();
    });

    it("parses skills.sh URL", () => {
      const result = parseSkillImportSource(
        "https://skills.sh/owner/repo/skill",
      );
      expect(result.resolvedSource).toBe("https://github.com/owner/repo");
      expect(result.requestedSkillSlug).toBe("skill");
      expect(result.originalSkillsShUrl).toBe(
        "https://skills.sh/owner/repo/skill",
      );
    });

    it("passes through GitHub URL", () => {
      const result = parseSkillImportSource(
        "https://github.com/owner/repo",
      );
      expect(result.resolvedSource).toBe(
        "https://github.com/owner/repo",
      );
      expect(result.requestedSkillSlug).toBeNull();
      expect(result.originalSkillsShUrl).toBeNull();
    });

    it("passes through local path", () => {
      const result = parseSkillImportSource("/local/path");
      expect(result.resolvedSource).toBe("/local/path");
      expect(result.requestedSkillSlug).toBeNull();
      expect(result.originalSkillsShUrl).toBeNull();
    });

    it("handles skills.sh URL without skill slug", () => {
      const result = parseSkillImportSource(
        "https://skills.sh/owner/repo",
      );
      expect(result.resolvedSource).toBe("https://github.com/owner/repo");
      expect(result.requestedSkillSlug).toBeNull();
    });
  });
});
