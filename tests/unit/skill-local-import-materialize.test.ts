import { existsSync, statSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "@main/database";
import { MAX_SKILL_FILE_BYTES, MAX_TOTAL_BYTES } from "@main/skill-github";
import { importFromLocal } from "@main/skills/import-local";

describe("local skill import materialization", () => {
  let tempDir: string;
  let db: AppDatabase;
  let companyId: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-skill-local-import-"));
    db = new AppDatabase(tempDir);
    db.init();
    companyId = db.core.company.saveCompany({
      name: "Local Skill Import Test",
      description: "Materializes complete local skill packages",
      status: "active",
    });
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("copies local inventory files and records executable sources as scripts", async () => {
    const sourceDir = join(tempDir, "source", "review");
    await mkdir(join(sourceDir, "references"), { recursive: true });
    await mkdir(join(sourceDir, "scripts"), { recursive: true });
    await mkdir(join(sourceDir, "assets"), { recursive: true });
    await writeFile(join(sourceDir, "SKILL.md"), "---\nname: Review\nslug: review\n---\n# Review\n", "utf-8");
    await writeFile(join(sourceDir, "references", "api.md"), "API notes", "utf-8");
    await writeFile(join(sourceDir, "scripts", "run.sh"), "echo review\n", "utf-8");
    await chmod(join(sourceDir, "scripts", "run.sh"), 0o755);
    await writeFile(join(sourceDir, "assets", "logo.bin"), new Uint8Array([7, 8, 9]));

    const results = await importFromLocal({
      db,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      skillFilesDir: (ownerCompanyId, slug) => join(tempDir, "skills", ownerCompanyId, slug),
    }, companyId, sourceDir);

    expect(results).toHaveLength(1);
    const materializedDir = join(tempDir, "skills", companyId, "review");
    await expect(readFile(join(materializedDir, "SKILL.md"), "utf-8")).resolves.toContain("# Review");
    await expect(readFile(join(materializedDir, "references", "api.md"), "utf-8")).resolves.toBe("API notes");
    await expect(readFile(join(materializedDir, "scripts", "run.sh"), "utf-8")).resolves.toBe("echo review\n");
    await expect(readFile(join(materializedDir, "assets", "logo.bin"))).resolves.toEqual(Buffer.from([7, 8, 9]));
    expect(statSync(join(materializedDir, "scripts", "run.sh")).mode & 0o100).toBe(0o100);
    expect(statSync(join(materializedDir, "scripts", "run.sh")).mode & 0o011).toBe(0);

    const [skill] = db.core.skills.listCompanySkills(companyId);
    expect(skill?.trustLevel).toBe("scripts_executables");
    expect(skill?.fileInventory).toEqual([
      { path: "SKILL.md", kind: "skill" },
      { path: "assets/logo.bin", kind: "asset" },
      { path: "references/api.md", kind: "reference" },
      { path: "scripts/run.sh", kind: "script" },
    ]);
    expect(existsSync(materializedDir)).toBe(true);
  });

  it("rejects local packages whose aggregate size exceeds the limit before reading oversized inventory", async () => {
    const sourceDir = join(tempDir, "source", "large");
    await mkdir(join(sourceDir, "assets"), { recursive: true });
    await writeFile(join(sourceDir, "SKILL.md"), "---\nname: Large\nslug: large\n---\n", "utf-8");

    const fileCount = Math.ceil(MAX_TOTAL_BYTES / MAX_SKILL_FILE_BYTES) + 1;
    for (let index = 0; index < fileCount; index += 1) {
      await writeFile(join(sourceDir, "assets", `chunk-${index}.bin`), "");
      await truncate(join(sourceDir, "assets", `chunk-${index}.bin`), MAX_SKILL_FILE_BYTES);
    }

    await expect(importFromLocal({
      db,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      skillFilesDir: (ownerCompanyId, slug) => join(tempDir, "skills", ownerCompanyId, slug),
    }, companyId, sourceDir)).rejects.toThrow(
      `Skill package exceeded aggregate limit of ${MAX_TOTAL_BYTES} bytes`,
    );

    expect(existsSync(join(tempDir, "skills", companyId, "large"))).toBe(false);
    expect(db.core.skills.listCompanySkills(companyId)).toEqual([]);
  });
});
