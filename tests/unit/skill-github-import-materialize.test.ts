import { mkdtemp, readFile, rm } from "node:fs/promises";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "@main/database";
import { createGitHubImporter } from "@main/skills/import-github";

const commitSha = "a".repeat(40);

describe("GitHub skill import materialization", () => {
  let tempDir: string;
  let db: AppDatabase;
  let companyId: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-skill-github-import-"));
    db = new AppDatabase(tempDir);
    db.init();
    companyId = db.core.company.saveCompany({
      name: "GitHub Skill Import Test",
      description: "Materializes complete GitHub skill packages",
      status: "active",
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("downloads and materializes GitHub inventory files", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://api.github.com/repos/acme/skills/commits/HEAD") {
        return new Response(commitSha);
      }
      if (url === `https://api.github.com/repos/acme/skills/git/trees/${commitSha}?recursive=1`) {
        return new Response(JSON.stringify({
          sha: commitSha,
          tree: [
            { path: "review/SKILL.md", type: "blob", mode: "100644" },
            { path: "review/references/api.md", type: "blob", mode: "100644" },
            { path: "review/scripts/run.sh", type: "blob", mode: "100755" },
          ],
        }));
      }
      if (url === `https://raw.githubusercontent.com/acme/skills/${commitSha}/review/SKILL.md`) {
        return new Response("---\nname: Review\nslug: review\n---\n# Review\n");
      }
      if (url === `https://raw.githubusercontent.com/acme/skills/${commitSha}/review/references/api.md`) {
        return new Response("API notes");
      }
      if (url === `https://raw.githubusercontent.com/acme/skills/${commitSha}/review/scripts/run.sh`) {
        return new Response("echo review\n");
      }
      return new Response("missing", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const importer = createGitHubImporter({
      db,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      skillFilesDir: (ownerCompanyId, slug) => join(tempDir, "skills", ownerCompanyId, slug),
    });

    const results = await importer.importFromGitHub(companyId, "https://github.com/acme/skills", null, null);

    expect(results).toHaveLength(1);
    const materializedDir = join(tempDir, "skills", companyId, "review");
    await expect(readFile(join(materializedDir, "SKILL.md"), "utf-8")).resolves.toContain("# Review");
    await expect(readFile(join(materializedDir, "references", "api.md"), "utf-8")).resolves.toBe("API notes");
    await expect(readFile(join(materializedDir, "scripts", "run.sh"), "utf-8")).resolves.toBe("echo review\n");
    expect(statSync(join(materializedDir, "scripts", "run.sh")).mode & 0o100).toBe(0o100);
    expect(statSync(join(materializedDir, "scripts", "run.sh")).mode & 0o011).toBe(0);

    const [skill] = db.core.skills.listCompanySkills(companyId);
    expect(skill?.trustLevel).toBe("scripts_executables");
    expect(skill?.fileInventory).toEqual([
      { path: "SKILL.md", kind: "skill" },
      { path: "references/api.md", kind: "reference" },
      { path: "scripts/run.sh", kind: "script" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(`https://raw.githubusercontent.com/acme/skills/${commitSha}/review/references/api.md`);
    expect(fetchMock).toHaveBeenCalledWith(`https://raw.githubusercontent.com/acme/skills/${commitSha}/review/scripts/run.sh`);
  });
});
