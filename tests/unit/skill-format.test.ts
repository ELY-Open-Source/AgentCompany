import { describe, it, expect } from "vitest";
import {
  parseFrontmatterMarkdown,
  classifyInventoryKind,
  deriveTrustLevel,
  estimateTokens,
} from "@main/skill-format";
import type { FileInventoryEntry } from "@main/skill-types";

describe("skill-format", () => {
  describe("parseFrontmatterMarkdown", () => {
    it("parses standard frontmatter and body", () => {
      const result = parseFrontmatterMarkdown(
        "---\nname: test\nslug: test\n---\n# Body",
      );
      expect(result.frontmatter).toEqual({ name: "test", slug: "test" });
      expect(result.body).toBe("# Body");
    });

    it("returns empty frontmatter for text without frontmatter", () => {
      const result = parseFrontmatterMarkdown("No frontmatter");
      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe("No frontmatter");
    });

    it("handles frontmatter with no body", () => {
      const result = parseFrontmatterMarkdown("---\nname: test\n---");
      expect(result.frontmatter).toEqual({ name: "test" });
      expect(result.body).toBe("");
    });

    it("normalizes CRLF to LF before parsing", () => {
      const result = parseFrontmatterMarkdown(
        "---\r\nname: test\r\n---\r\n# Body",
      );
      expect(result.frontmatter).toEqual({ name: "test" });
      expect(result.body).toBe("# Body");
    });

    it("handles quoted string values", () => {
      const result = parseFrontmatterMarkdown(
        '---\nname: "My Skill"\n---\n',
      );
      expect(result.frontmatter.name).toBe("My Skill");
    });

    it("parses boolean values", () => {
      const result = parseFrontmatterMarkdown(
        "---\nenabled: true\ndisabled: false\n---\n",
      );
      expect(result.frontmatter.enabled).toBe(true);
      expect(result.frontmatter.disabled).toBe(false);
    });

    it("parses numeric values", () => {
      const result = parseFrontmatterMarkdown(
        "---\nversion: 42\nprecision: 3.14\n---\n",
      );
      expect(result.frontmatter.version).toBe(42);
      expect(result.frontmatter.precision).toBe(3.14);
    });

    it("parses null values", () => {
      const result = parseFrontmatterMarkdown("---\nvalue: null\n---\n");
      expect(result.frontmatter.value).toBeNull();
    });

    it("handles empty arrays and objects", () => {
      const result = parseFrontmatterMarkdown(
        "---\nitems: []\nopts: {}\n---\n",
      );
      expect(result.frontmatter.items).toEqual([]);
      expect(result.frontmatter.opts).toEqual({});
    });

    it("handles body with multiple lines", () => {
      const result = parseFrontmatterMarkdown(
        "---\nname: test\n---\nLine 1\nLine 2\nLine 3",
      );
      expect(result.body).toBe("Line 1\nLine 2\nLine 3");
    });
  });

  describe("classifyInventoryKind", () => {
    it("classifies SKILL.md as skill", () => {
      expect(classifyInventoryKind("SKILL.md")).toBe("skill");
    });

    it("classifies nested SKILL.md as skill", () => {
      expect(classifyInventoryKind("subdir/SKILL.md")).toBe("skill");
    });

    it("classifies references/ path as reference", () => {
      expect(classifyInventoryKind("references/api.md")).toBe("reference");
    });

    it("classifies scripts/ path as script", () => {
      expect(classifyInventoryKind("scripts/build.sh")).toBe("script");
    });

    it("classifies assets/ path as asset", () => {
      expect(classifyInventoryKind("assets/logo.png")).toBe("asset");
    });

    it("classifies .md files as markdown", () => {
      expect(classifyInventoryKind("docs/guide.md")).toBe("markdown");
    });

    it("classifies config.json as other", () => {
      expect(classifyInventoryKind("config.json")).toBe("other");
    });

    it("classifies .py files as script", () => {
      expect(classifyInventoryKind("helper.py")).toBe("script");
    });

    it("classifies .sh files as script", () => {
      expect(classifyInventoryKind("run.sh")).toBe("script");
    });

    it("classifies .js files as script", () => {
      expect(classifyInventoryKind("index.js")).toBe("script");
    });

    it("classifies .ts files as script", () => {
      expect(classifyInventoryKind("main.ts")).toBe("script");
    });

    it("classifies image files as asset", () => {
      expect(classifyInventoryKind("photo.jpg")).toBe("asset");
      expect(classifyInventoryKind("icon.svg")).toBe("asset");
      expect(classifyInventoryKind("banner.webp")).toBe("asset");
      expect(classifyInventoryKind("doc.pdf")).toBe("asset");
    });

    it("handles case insensitivity", () => {
      expect(classifyInventoryKind("Skill.MD")).toBe("skill");
      expect(classifyInventoryKind("References/API.md")).toBe("reference");
    });
  });

  describe("deriveTrustLevel", () => {
    it("returns scripts_executables when any script file exists", () => {
      const inventory: FileInventoryEntry[] = [
        { path: "SKILL.md", kind: "skill" },
        { path: "scripts/build.sh", kind: "script" },
      ];
      expect(deriveTrustLevel(inventory)).toBe("scripts_executables");
    });

    it("returns assets when asset but no script exists", () => {
      const inventory: FileInventoryEntry[] = [
        { path: "SKILL.md", kind: "skill" },
        { path: "assets/logo.png", kind: "asset" },
      ];
      expect(deriveTrustLevel(inventory)).toBe("assets");
    });

    it("returns assets when other but no script exists", () => {
      const inventory: FileInventoryEntry[] = [
        { path: "SKILL.md", kind: "skill" },
        { path: "config.json", kind: "other" },
      ];
      expect(deriveTrustLevel(inventory)).toBe("assets");
    });

    it("returns markdown_only when only markdown and skill files exist", () => {
      const inventory: FileInventoryEntry[] = [
        { path: "SKILL.md", kind: "skill" },
        { path: "references/api.md", kind: "reference" },
        { path: "docs/guide.md", kind: "markdown" },
      ];
      expect(deriveTrustLevel(inventory)).toBe("markdown_only");
    });

    it("returns markdown_only for empty inventory", () => {
      expect(deriveTrustLevel([])).toBe("markdown_only");
    });
  });

  describe("estimateTokens", () => {
    it("returns 1 for a 4-character string", () => {
      expect(estimateTokens("abcd")).toBe(1);
    });

    it("returns 0 for empty string", () => {
      expect(estimateTokens("")).toBe(0);
    });

    it("rounds up with Math.ceil", () => {
      expect(estimateTokens("ab")).toBe(1);
      expect(estimateTokens("abcde")).toBe(2);
    });

    it("handles longer strings", () => {
      const text = "a".repeat(100);
      expect(estimateTokens(text)).toBe(25);
    });
  });
});
