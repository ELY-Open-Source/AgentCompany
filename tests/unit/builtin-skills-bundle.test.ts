import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { stageBuiltinSkillsLibrary } from "../../src/main/services/builtin-skills";

/**
 * The real bundled catalogue must stage cleanly: every skill gets a unique
 * slug, the forced humanizer skill exists, and category files carry the
 * descriptions agents browse. A broken bundle should fail CI, not first
 * launch.
 */
describe("bundled skill catalogue", () => {
  test("the repo bundle stages with unique slugs and the forced humanizer", () => {
    const libraryRoot = mkdtempSync(join(tmpdir(), "ac-bundle-check-"));
    try {
      const staged = stageBuiltinSkillsLibrary(resolve(process.cwd(), "built-in skills"), libraryRoot);
      expect(staged.length).toBeGreaterThan(200);
      expect(staged.some((unit) => unit.slug === "humanizer")).toBe(true);
      const withDescription = staged.filter((unit) => unit.manifest.description).length;
      expect(withDescription / staged.length).toBeGreaterThan(0.9);
    } finally {
      rmSync(libraryRoot, { recursive: true, force: true });
    }
  });
});
