import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, basename, dirname, isAbsolute, relative } from "node:path";
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
import { materializeSkillFiles, normalizeMaterializedRelativePath, type MaterializedSkillFile } from "./materialize";
import { MAX_SKILL_BYTES, MAX_SKILL_FILE_BYTES, MAX_TOTAL_BYTES } from "../skill-github.js";

export interface LocalImportContext {
  db: AppDatabase;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  skillFilesDir: (companyId: string, slug: string) => string;
}

function assertLocalFileSize(filePath: string, size: number, maxBytes: number): void {
  if (size > maxBytes) {
    throw new Error(`${filePath} exceeds ${maxBytes}-byte limit`);
  }
}

function assertLocalPackageSize(totalBytes: number): void {
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new Error(`Skill package exceeded aggregate limit of ${MAX_TOTAL_BYTES} bytes`);
  }
}

function readLocalSkillMarkdown(skillMdPath: string): string {
  const stat = statSync(skillMdPath);
  if (!stat.isFile()) {
    throw new Error(`Local skill path is not a file: ${skillMdPath}`);
  }
  assertLocalFileSize(skillMdPath, stat.size, MAX_SKILL_BYTES);
  return readFileSync(skillMdPath, "utf-8");
}

function assertPathInsideRoot(rootDir: string, targetPath: string, relativePath: string): void {
  const relativePathFromRoot = relative(rootDir, targetPath);
  if (relativePathFromRoot.length === 0 || relativePathFromRoot.startsWith("..") || isAbsolute(relativePathFromRoot)) {
    throw new Error(`Skill inventory path escapes source directory: ${relativePath}`);
  }
}

function buildLocalMaterializedFiles(
  skillDir: string,
  markdown: string,
  markdownBytes: number,
  inventory: FileInventoryEntry[],
): MaterializedSkillFile[] {
  const realSkillDir = realpathSync(skillDir);
  const files: MaterializedSkillFile[] = [
    { path: "SKILL.md", kind: "skill", content: markdown },
  ];
  let totalBytes = markdownBytes;
  assertLocalPackageSize(totalBytes);

  for (const entry of inventory) {
    if (entry.path === "SKILL.md") continue;
    const relativePath = normalizeMaterializedRelativePath(entry.path);
    const sourcePath = resolve(realSkillDir, ...relativePath.split("/"));
    const realSourcePath = realpathSync(sourcePath);
    assertPathInsideRoot(realSkillDir, realSourcePath, relativePath);
    const stat = statSync(realSourcePath);
    if (!stat.isFile()) {
      throw new Error(`Skill inventory path is not a file: ${relativePath}`);
    }
    assertLocalFileSize(relativePath, stat.size, MAX_SKILL_FILE_BYTES);
    totalBytes += stat.size;
    assertLocalPackageSize(totalBytes);
    files.push({
      path: relativePath,
      kind: entry.kind,
      content: readFileSync(realSourcePath),
    });
  }

  return files;
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
    const markdown = readLocalSkillMarkdown(resolvedPath);
    assertLocalPackageSize(Buffer.byteLength(markdown, "utf-8"));
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
    await materializeSkillFiles(skillFilesDir(companyId, rawSlug), [
      { path: "SKILL.md", kind: "skill", content: markdown },
    ]);

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
    const markdown = readLocalSkillMarkdown(skillMdPath);
    const markdownBytes = Buffer.byteLength(markdown, "utf-8");
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
    await materializeSkillFiles(
      skillFilesDir(companyId, rawSlug),
      buildLocalMaterializedFiles(skillDir, markdown, markdownBytes, inventory),
    );

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
