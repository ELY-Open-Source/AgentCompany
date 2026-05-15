import { existsSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_SKILL_FILE_BYTES, MAX_TOTAL_BYTES } from "@main/skill-github";
import { materializeSkillFiles } from "@main/skills/materialize";

describe("skill materialization", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-skill-materialize-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("materializes every inventory file and preserves script executability", async () => {
    const dir = join(tempDir, "skills", "company", "review");

    await materializeSkillFiles(dir, [
      { path: "SKILL.md", kind: "skill", content: "---\nname: Review\n---\n" },
      { path: "references/api.md", kind: "reference", content: "API notes" },
      { path: "assets/logo.bin", kind: "asset", content: new Uint8Array([1, 2, 3]) },
      { path: "scripts/run.sh", kind: "script", content: "echo review\n" },
    ]);

    await expect(readFile(join(dir, "SKILL.md"), "utf-8")).resolves.toContain("Review");
    await expect(readFile(join(dir, "references", "api.md"), "utf-8")).resolves.toBe("API notes");
    await expect(readFile(join(dir, "assets", "logo.bin"))).resolves.toEqual(Buffer.from([1, 2, 3]));
    await expect(readFile(join(dir, "scripts", "run.sh"), "utf-8")).resolves.toBe("echo review\n");
    expect(statSync(join(dir, "scripts", "run.sh")).mode & 0o100).toBe(0o100);
    expect(statSync(join(dir, "scripts", "run.sh")).mode & 0o011).toBe(0);
    expect(statSync(join(dir, "references", "api.md")).mode & 0o111).toBe(0);
  });

  it("replaces stale files when a skill is re-materialized", async () => {
    const dir = join(tempDir, "skills", "company", "review");
    await materializeSkillFiles(dir, [
      { path: "SKILL.md", kind: "skill", content: "old" },
      { path: "references/stale.md", kind: "reference", content: "stale" },
    ]);

    await materializeSkillFiles(dir, [
      { path: "SKILL.md", kind: "skill", content: "new" },
    ]);

    await expect(readFile(join(dir, "SKILL.md"), "utf-8")).resolves.toBe("new");
    expect(existsSync(join(dir, "references", "stale.md"))).toBe(false);
  });

  it("rejects traversal paths before writing the package", async () => {
    const dir = join(tempDir, "skills", "company", "bad");

    await expect(materializeSkillFiles(dir, [
      { path: "SKILL.md", kind: "skill", content: "ok" },
      { path: "../escape.md", kind: "markdown", content: "bad" },
    ])).rejects.toThrow("Skill file path contains traversal segments: ../escape.md");
    expect(existsSync(dir)).toBe(false);
  });

  it("enforces single-file and aggregate package byte limits", async () => {
    const dir = join(tempDir, "skills", "company", "large");

    await expect(materializeSkillFiles(dir, [
      { path: "SKILL.md", kind: "skill", content: "ok" },
      { path: "assets/too-large.bin", kind: "asset", content: new Uint8Array(MAX_SKILL_FILE_BYTES + 1) },
    ])).rejects.toThrow(`assets/too-large.bin exceeds ${MAX_SKILL_FILE_BYTES}-byte limit`);

    const packageFiles = [
      { path: "SKILL.md", kind: "skill" as const, content: "ok" },
      ...Array.from({ length: Math.ceil(MAX_TOTAL_BYTES / MAX_SKILL_FILE_BYTES) }, (_, index) => ({
        path: `assets/chunk-${index}.bin`,
        kind: "asset" as const,
        content: new Uint8Array(MAX_SKILL_FILE_BYTES),
      })),
    ];
    await expect(materializeSkillFiles(dir, packageFiles)).rejects.toThrow(
      `Skill package exceeded aggregate limit of ${MAX_TOTAL_BYTES} bytes`,
    );
  });
});
