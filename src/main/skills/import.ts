import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve, basename, dirname, relative } from "node:path";
import type { AppDatabase } from "../database";
import type { DesktopResult } from "@shared/contracts";
import type { FileInventoryEntry, SkillImportResult } from "../skill-types.js";
import {
  parseFrontmatterMarkdown,
  classifyInventoryKind,
  deriveTrustLevel,
} from "../skill-format.js";
import {
  deriveCanonicalSkillKey,
  normalizeSkillSlug,
  hashSkillValue,
  parseSkillImportSource,
} from "../skill-keys.js";
import { createGitHubImporter } from "./import-github";

interface ImportDeps {
  db: AppDatabase;
  profileDir: string;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  skillsRoot: (companyId: string) => string;
  skillFilesDir: (companyId: string, slug: string) => string;
}

export function createSkillImporter({ db, profileDir: _profileDir, logger, skillsRoot: _skillsRoot, skillFilesDir }: ImportDeps) {
  function ok<T>(data: T): DesktopResult<T> {
    return { ok: true, data };
  }
  function fail(code: string, message: string): DesktopResult<never> {
    return { ok: false, error: { code, message } };
  }

  const ghImporter = createGitHubImporter({ db, logger, skillFilesDir });

  async function materializeSkillFiles(
    companyId: string,
    slug: string,
    markdown: string,
    _inventory: FileInventoryEntry[],
  ): Promise<string> {
    const dir = skillFilesDir(companyId, slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), markdown, "utf-8");
    return dir;
  }

  async function cleanupSkillFiles(companyId: string, slug: string): Promise<void> {
    const dir = skillFilesDir(companyId, slug);
    if (existsSync(dir)) {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async function importFromSource(
    companyId: string,
    rawSource: string,
  ): Promise<DesktopResult<SkillImportResult[]>> {
    try {
      const parsed = parseSkillImportSource(rawSource);
      const source = parsed.resolvedSource;

      if (parsed.originalSkillsShUrl) {
        const results = await ghImporter.importFromGitHub(
          companyId,
          source,
          parsed.requestedSkillSlug,
          parsed.originalSkillsShUrl,
        );
        return ok(results);
      }

      if (source.includes("github.com")) {
        const results = await ghImporter.importFromGitHub(
          companyId,
          source,
          parsed.requestedSkillSlug,
          null,
        );
        return ok(results);
      }

      if (
        source.startsWith("/") ||
        /^[A-Za-z]:/.test(source) ||
        source.startsWith("~")
      ) {
        const results = await importFromLocal(companyId, source);
        return ok(results);
      }

      if (/^https?:\/\//i.test(source)) {
        const results = await importFromUrl(companyId, source);
        return ok(results);
      }

      return fail("invalid_source", `Unrecognized skill source format: ${rawSource}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Skill import failed:", message);
      return fail("import_error", message);
    }
  }

  async function importFromLocal(
    companyId: string,
    localPath: string,
  ): Promise<SkillImportResult[]> {
    const resolvedPath = resolve(localPath.replace(/^~/, process.env.HOME ?? process.env.USERPROFILE ?? ""));

    if (!existsSync(resolvedPath)) {
      throw new Error(`Local path does not exist: ${resolvedPath}`);
    }

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
      await materializeSkillFiles(companyId, rawSlug, markdown, inventory);

      const { isUpdate } = db.upsertCompanySkill({
        id: skillId,
        companyId,
        key,
        slug: rawSlug,
        name: (typeof parsed.frontmatter.name === "string" ? parsed.frontmatter.name : null) ?? rawSlug,
        description: typeof parsed.frontmatter.description === "string" ? parsed.frontmatter.description : null,
        markdown,
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
    const skillMdFiles = findSkillMdFiles(resolvedPath);
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

      const inventory = buildLocalInventory(skillDir, skillMdPath);
      const trustLevel = deriveTrustLevel(inventory);
      const contentHash = hashSkillValue(markdown);

      const key = deriveCanonicalSkillKey(companyId, {
        slug: rawSlug,
        sourceType: "local_path",
        sourceLocator: skillDir,
        metadata: null,
      });

      const skillId = randomUUID();
      await materializeSkillFiles(companyId, rawSlug, markdown, inventory);

      const { isUpdate } = db.upsertCompanySkill({
        id: skillId,
        companyId,
        key,
        slug: rawSlug,
        name: (typeof parsed.frontmatter.name === "string" ? parsed.frontmatter.name : null) ?? rawSlug,
        description: typeof parsed.frontmatter.description === "string" ? parsed.frontmatter.description : null,
        markdown,
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

  async function importFromUrl(
    companyId: string,
    url: string,
  ): Promise<SkillImportResult[]> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch skill from URL: ${response.status} ${url}`);
    }
    const markdown = await response.text();
    const parsed = parseFrontmatterMarkdown(markdown);
    const nowTs = new Date().toISOString();

    let urlSlug: string | null = null;
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split("/").filter(Boolean);
      const lastPart = pathParts[pathParts.length - 1] ?? "";
      urlSlug = normalizeSkillSlug(lastPart.replace(/\.md$/i, ""));
    } catch {
      // ignore URL parsing errors
    }
    const rawSlug =
      normalizeSkillSlug(parsed.frontmatter.slug as string | undefined) ??
      urlSlug ??
      "skill";

    const inventory: FileInventoryEntry[] = [
      { path: "SKILL.md", kind: "skill" },
    ];
    const trustLevel = "markdown_only" as const;

    const key = deriveCanonicalSkillKey(companyId, {
      slug: rawSlug,
      sourceType: "url",
      sourceLocator: url,
      metadata: null,
    });

    const skillId = randomUUID();
    await materializeSkillFiles(companyId, rawSlug, markdown, inventory);

    const { isUpdate } = db.upsertCompanySkill({
      id: skillId,
      companyId,
      key,
      slug: rawSlug,
      name: (typeof parsed.frontmatter.name === "string" ? parsed.frontmatter.name : null) ?? rawSlug,
      description: typeof parsed.frontmatter.description === "string" ? parsed.frontmatter.description : null,
      markdown,
      sourceType: "url",
      sourceLocator: url,
      sourceRef: null,
      trustLevel,
      compatibility: "compatible",
      fileInventory: JSON.stringify(inventory),
      metadata: null,
      createdAt: nowTs,
      updatedAt: nowTs,
    });

    const results: SkillImportResult[] = [
      { skillId, key, name: rawSlug, isUpdate },
    ];
    logger.info(`Skill ${isUpdate ? "updated" : "imported"} from URL: ${key}`);
    return results;
  }

  function findSkillMdFiles(rootDir: string): string[] {
    const found: string[] = [];
    function walk(dir: string) {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (entry.name === "SKILL.md") {
            found.push(fullPath);
          }
        }
      } catch {
        // Skip unreadable directories
      }
    }
    walk(rootDir);
    return found;
  }

  function buildLocalInventory(skillDir: string, skillMdPath: string): FileInventoryEntry[] {
    const inventory: FileInventoryEntry[] = [
      { path: "SKILL.md", kind: "skill" },
    ];
    try {
      const entries = readdirSync(skillDir, { withFileTypes: true, recursive: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const entryPath = entry.parentPath
          ? join(entry.parentPath, entry.name)
          : join(skillDir, entry.name);
        const fullPath = resolve(entryPath);
        if (fullPath === skillMdPath) continue;
        const relativePath = relative(skillDir, fullPath).replace(/\\/g, "/");
        inventory.push({
          path: relativePath,
          kind: classifyInventoryKind(relativePath),
        });
      }
    } catch {
      // If directory listing fails, return just the SKILL.md entry
    }
    return inventory;
  }

  return {
    importFromSource,
    importFromGitHub: ghImporter.importFromGitHub,
    importFromLocal,
    importFromUrl,
    cleanupSkillFiles,
    parseGitHubUrl: ghImporter.parseGitHubUrl,
    findSkillMdFiles,
    buildLocalInventory,
  };
}
