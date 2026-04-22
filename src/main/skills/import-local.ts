import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, basename, dirname } from "node:path";
import type { AppDatabase } from "../database";
import type { FileInventoryEntry, SkillImportResult } from "../skill-types.js";
import { parseFrontmatterMarkdown, deriveTrustLevel } from "../skill-format.js";
import {
  deriveCanonicalSkillKey,
  normalizeSkillSlug,
  hashSkillValue,
} from "../skill-keys.js";
import {
  assertNotSystemPath,
  findSkillMdFiles,
  buildLocalInventory,
} from "./discovery";
import { materializeSkillFiles } from "./materialize";

export interface LocalImportContext {
  db: AppDatabase;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  skillFilesDir: (companyId: string, slug: string) => string;
}

export async function importFromLocal(
  ctx: LocalImportContext,
  companyId: string,
  localPath: string,
): Promise<SkillImportResult[]> {
  const { db, logger, skillFilesDir } = ctx;
  const resolvedPath = resolve(localPath.replace(/^~/, process.env.HOME ?? process.env.USERPROFILE ?? ""));

  if (!existsSync(resolvedPath)) {
    throw new Error(`Local path does not exist: ${resolvedPath}`);
  }

  // Resolve symlinks to prevent traversal attacks (agent importing /tmp/evil-link → /etc/shadow)
  const realPath = realpathSync(resolvedPath);
  assertNotSystemPath(realPath);

  const stat = statSync(resolvedPath);
  const results: SkillImportResult[] = [];
  const nowTs = new Date().toISOString();

  if (stat.isFile()) {
    const markdown = readFileSync(resolvedPath, "utf-8");
    const parsed = parseFrontmatterMarkdown(markdown);
    const rawSlug =
      normalizeSkillSlug(parsed.frontmatter.slug as string | undefined) ??
      normalizeSkillSlug(basename(resolvedPath, ".md")) ??
      "skill";
    const inventory: FileInventoryEntry[] = [
      { path: "SKILL.md", kind: "skill" },
    ];
    const trustLevel = deriveTrustLevel(inventory);
    const contentHash = hashSkillValue(markdown);

    const key = deriveCanonicalSkillKey(companyId, {
      slug: rawSlug,
      sourceType: "local_path",
      sourceLocator: resolvedPath,
      metadata: null,
    });

    const skillId = randomUUID();
    await materializeSkillFiles(skillFilesDir(companyId, rawSlug), markdown, inventory);

    const { isUpdate } = db.core.skills.upsertCompanySkill({
      id: skillId,
      companyId,
      key,
      slug: rawSlug,
      name: (typeof parsed.frontmatter.name === "string" ? parsed.frontmatter.name : null) ?? rawSlug,
      description: typeof parsed.frontmatter.description === "string" ? parsed.frontmatter.description : null,
      sourceType: "local_path",
      sourceLocator: resolvedPath,
      sourceRef: contentHash,
      trustLevel,
      compatibility: "compatible",
      fileInventory: JSON.stringify(inventory),
      metadata: null,
      createdAt: nowTs,
      updatedAt: nowTs,
    });

    results.push({ skillId, key, name: rawSlug, isUpdate });
    logger.info(`Skill ${isUpdate ? "updated" : "imported"} from local file: ${key}`);
    return results;
  }

  // Directory: walk to find SKILL.md files
  const skillMdFiles = findSkillMdFiles(resolvedPath, logger);
  if (skillMdFiles.length === 0) {
    throw new Error(`No SKILL.md files found in ${resolvedPath}`);
  }

  for (const skillMdPath of skillMdFiles) {
    const skillDir = dirname(skillMdPath);
    const markdown = readFileSync(skillMdPath, "utf-8");
    const parsed = parseFrontmatterMarkdown(markdown);
    const rawSlug =
      normalizeSkillSlug(parsed.frontmatter.slug as string | undefined) ??
      normalizeSkillSlug(basename(skillDir)) ??
      "skill";

    const inventory = buildLocalInventory(skillDir, skillMdPath, logger);
    const trustLevel = deriveTrustLevel(inventory);
    const contentHash = hashSkillValue(markdown);

    const key = deriveCanonicalSkillKey(companyId, {
      slug: rawSlug,
      sourceType: "local_path",
      sourceLocator: skillDir,
      metadata: null,
    });

    const skillId = randomUUID();
    await materializeSkillFiles(skillFilesDir(companyId, rawSlug), markdown, inventory);

    const { isUpdate } = db.core.skills.upsertCompanySkill({
      id: skillId,
      companyId,
      key,
      slug: rawSlug,
      name: (typeof parsed.frontmatter.name === "string" ? parsed.frontmatter.name : null) ?? rawSlug,
      description: typeof parsed.frontmatter.description === "string" ? parsed.frontmatter.description : null,
      sourceType: "local_path",
      sourceLocator: skillDir,
      sourceRef: contentHash,
      trustLevel,
      compatibility: "compatible",
      fileInventory: JSON.stringify(inventory),
      metadata: null,
      createdAt: nowTs,
      updatedAt: nowTs,
    });

    results.push({ skillId, key, name: rawSlug, isUpdate });
    logger.info(`Skill ${isUpdate ? "updated" : "imported"} from local path: ${key}`);
  }

  return results;
}
