import { randomUUID } from "node:crypto";
import { basename, dirname } from "node:path";
import type { AppDatabase } from "../database";
import type { FileInventoryEntry, SkillImportResult, SkillSourceType } from "../skill-types.js";
import {
  parseFrontmatterMarkdown,
  classifyInventoryKind,
  deriveTrustLevel,
} from "../skill-format.js";
import {
  deriveCanonicalSkillKey,
  normalizeSkillSlug,
} from "../skill-keys.js";
import {
  resolveGitHubCommitSha,
  fetchGitHubSkills,
} from "../skill-github.js";
import { materializeSkillFiles, type MaterializedSkillFile } from "./materialize";

interface GitHubImportDeps {
  db: AppDatabase;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  skillFilesDir: (companyId: string, slug: string) => string;
}

export function createGitHubImporter({ db, logger, skillFilesDir }: GitHubImportDeps) {
  function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== "github.com") return null;
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length < 2) return null;
      return {
        owner: parts[0]!,
        repo: parts[1]!.replace(/\.git$/i, ""),
      };
    } catch {
      return null;
    }
  }

  async function importFromGitHub(
    companyId: string,
    url: string,
    requestedSlug: string | null,
    originalSkillsShUrl: string | null,
  ): Promise<SkillImportResult[]> {
    const ghParsed = parseGitHubUrl(url);
    if (!ghParsed) {
      throw new Error(`Invalid GitHub URL: ${url}`);
    }
    const { owner, repo } = ghParsed;

    const sha = await resolveGitHubCommitSha(owner, repo, undefined, logger);
    if (!sha) {
      throw new Error(`Failed to resolve commit SHA for ${owner}/${repo}`);
    }

    const { skills: githubSkills, commitSha } = await fetchGitHubSkills(
      owner, repo, sha, requestedSlug, logger,
    );

    if (githubSkills.length === 0) {
      throw new Error(`No SKILL.md files found in ${owner}/${repo}`);
    }

    const results: SkillImportResult[] = [];
    const sourceType: SkillSourceType = originalSkillsShUrl ? "skills_sh" : "github";
    const nowTs = new Date().toISOString();

    for (const ghSkill of githubSkills) {
      const parsed = parseFrontmatterMarkdown(ghSkill.markdown);
      const rawSlug =
        normalizeSkillSlug(parsed.frontmatter.slug as string | undefined) ??
        normalizeSkillSlug(
          ghSkill.skillMdPath === "SKILL.md"
            ? repo
            : basename(dirname(ghSkill.skillMdPath)),
        ) ??
        repo;

      const skillDir =
        ghSkill.skillMdPath === "SKILL.md"
          ? ""
          : ghSkill.skillMdPath.slice(0, ghSkill.skillMdPath.lastIndexOf("/"));
      const prefix = skillDir ? `${skillDir}/` : "";
      const materializedFiles: MaterializedSkillFile[] = [
        { path: "SKILL.md", kind: "skill", content: ghSkill.markdown },
        ...ghSkill.files.map((file) => {
          const relativePath = prefix ? file.path.slice(prefix.length) : file.path;
          return {
            path: relativePath,
            kind: file.mode === "100755" ? "script" as const : classifyInventoryKind(relativePath),
            content: file.content,
          };
        }),
      ];
      const inventory: FileInventoryEntry[] = materializedFiles.map(({ path, kind }) => ({ path, kind }));

      const metadata: Record<string, unknown> = {
        sourceKind: "github",
        owner,
        repo,
        ref: commitSha,
        trackingRef: "HEAD",
        ...(originalSkillsShUrl ? { originalSkillsShUrl } : {}),
      };

      const key = deriveCanonicalSkillKey(companyId, {
        slug: rawSlug,
        sourceType,
        sourceLocator: url,
        metadata,
      });

      const trustLevel = deriveTrustLevel(inventory);
      const name =
        (typeof parsed.frontmatter.name === "string" ? parsed.frontmatter.name : null) ??
        rawSlug;
      const description =
        typeof parsed.frontmatter.description === "string"
          ? parsed.frontmatter.description
          : null;

      const skillId = randomUUID();

      await materializeSkillFiles(skillFilesDir(companyId, rawSlug), materializedFiles);

      const { isUpdate } = db.core.skills.upsertCompanySkill({
        id: skillId,
        companyId,
        key,
        slug: rawSlug,
        name,
        description,
        sourceType,
        sourceLocator: url,
        sourceRef: commitSha,
        trustLevel,
        compatibility: "compatible",
        fileInventory: JSON.stringify(inventory),
        metadata: JSON.stringify(metadata),
        createdAt: nowTs,
        updatedAt: nowTs,
      });

      results.push({ skillId, key, name, isUpdate });
      logger.info(`Skill ${isUpdate ? "updated" : "imported"}: ${key} from ${owner}/${repo}`);
    }

    return results;
  }

  return { parseGitHubUrl, importFromGitHub };
}
