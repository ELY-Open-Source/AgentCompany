// SkillService -- full skill lifecycle: import, CRUD, assignment, token budget,
// update detection. Factory pattern following createOrchestrationService.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve, basename, dirname, relative, posix } from "node:path";
import type { AppDatabase } from "./database";
import type { DesktopResult } from "@shared/contracts";
import type {
  FileInventoryEntry,
  SkillRecord,
  SkillImportResult,
  SkillSourceType,
  SkillUpdateStatus,
  RuntimeSkillEntry,
} from "./skill-types.js";
import {
  parseFrontmatterMarkdown,
  classifyInventoryKind,
  deriveTrustLevel,
  estimateTokens,
} from "./skill-format.js";
import {
  deriveCanonicalSkillKey,
  normalizeSkillSlug,
  hashSkillValue,
  parseSkillImportSource,
} from "./skill-keys.js";
import {
  resolveGitHubCommitSha,
  fetchGitHubSkills,
} from "./skill-github.js";
import { TOKEN_BUDGETS } from "./skill-types.js";

// Types
interface SkillServiceDependencies {
  db: AppDatabase;
  profileDir: string;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

// Factory
export function createSkillService({ db, profileDir, logger }: SkillServiceDependencies) {
  // ---- Result helpers ----
  function ok<T>(data: T): DesktopResult<T> {
    return { ok: true, data };
  }
  function fail(code: string, message: string): DesktopResult<never> {
    return { ok: false, error: { code, message } };
  }

  // ---- Path helpers (D-10: skills stored in profileDir/skills/{companyId}/) ----
  function skillsRoot(companyId: string): string {
    return join(profileDir, "skills", companyId);
  }

  function skillFilesDir(companyId: string, slug: string): string {
    return join(skillsRoot(companyId), slug);
  }

  function runtimeDir(companyId: string): string {
    return join(skillsRoot(companyId), "__runtime__");
  }

  /**
   * Write SKILL.md (and tracked inventory files from GitHub downloads)
   * to the local skill directory.
   */
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

  /** Remove a skill's file directory from disk. */
  async function cleanupSkillFiles(companyId: string, slug: string): Promise<void> {
    const dir = skillFilesDir(companyId, slug);
    if (existsSync(dir)) {
      await rm(dir, { recursive: true, force: true });
    }
  }

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

  /**
   * Import skills from any supported source.
   * Routes to the correct handler based on parseSkillImportSource.
   */
  async function importFromSource(
    companyId: string,
    rawSource: string,
  ): Promise<DesktopResult<SkillImportResult[]>> {
    try {
      const parsed = parseSkillImportSource(rawSource);
      const source = parsed.resolvedSource;

      // skills.sh resolved sources are always GitHub URLs
      if (parsed.originalSkillsShUrl) {
        const results = await importFromGitHub(
          companyId,
          source,
          parsed.requestedSkillSlug,
          parsed.originalSkillsShUrl,
        );
        return ok(results);
      }

      // GitHub URL
      if (source.includes("github.com")) {
        const results = await importFromGitHub(
          companyId,
          source,
          parsed.requestedSkillSlug,
          null,
        );
        return ok(results);
      }

      // Local path (absolute path, drive letter on Windows, or ~ home dir)
      if (
        source.startsWith("/") ||
        /^[A-Za-z]:/.test(source) ||
        source.startsWith("~")
      ) {
        const results = await importFromLocal(companyId, source);
        return ok(results);
      }

      // HTTP/HTTPS URL
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

    // Resolve latest commit SHA
    const sha = await resolveGitHubCommitSha(owner, repo, undefined, logger);
    if (!sha) {
      throw new Error(`Failed to resolve commit SHA for ${owner}/${repo}`);
    }

    // Fetch SKILL.md files from repo
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

      // Build file inventory from the tree paths
      const skillDir =
        ghSkill.skillMdPath === "SKILL.md"
          ? ""
          : ghSkill.skillMdPath.slice(0, ghSkill.skillMdPath.lastIndexOf("/"));
      const prefix = skillDir ? `${skillDir}/` : "";
      const inventory: FileInventoryEntry[] = [
        { path: "SKILL.md", kind: "skill" as const },
        ...ghSkill.inventory.map((filePath) => {
          const relativePath = prefix ? filePath.slice(prefix.length) : filePath;
          return {
            path: relativePath,
            kind: classifyInventoryKind(relativePath),
          };
        }),
      ];

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

      // Materialize files to disk
      await materializeSkillFiles(companyId, rawSlug, ghSkill.markdown, inventory);

      // Upsert to database
      const { isUpdate } = db.upsertCompanySkill({
        id: skillId,
        companyId,
        key,
        slug: rawSlug,
        name,
        description,
        markdown: ghSkill.markdown,
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
      // Single file treated as a skill
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

      // Build inventory from directory listing
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

    // Derive slug from frontmatter or URL path
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

    // Single-file skill: only SKILL.md
    const inventory: FileInventoryEntry[] = [
      { path: "SKILL.md", kind: "skill" },
    ];
    const trustLevel: "markdown_only" = "markdown_only";

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

  function listForCompany(companyId: string): SkillRecord[] {
    return db.listCompanySkills(companyId);
  }

  function getDetail(companyId: string, skillId: string): DesktopResult<SkillRecord> {
    const skill = db.getCompanySkill(companyId, skillId);
    if (!skill) return fail("not_found", `Skill ${skillId} not found`);
    return ok(skill);
  }

  /** Delete a skill: (1) assignments cascade via FK, (2) files from disk, (3) DB record per D-12. */
  async function deleteSkill(
    companyId: string,
    skillId: string,
  ): Promise<DesktopResult<void>> {
    const skill = db.getCompanySkill(companyId, skillId);
    if (!skill) return fail("not_found", `Skill ${skillId} not found`);

    try {
      // D-12 order: (1) assignments cascade via FK on delete,
      // (2) delete files from disk
      await cleanupSkillFiles(companyId, skill.slug);
      // (3) delete DB record (cascades agent_skill_assignments via FK)
      db.deleteCompanySkill(companyId, skillId);
      logger.info(`Skill deleted: ${skill.key}`);
      return ok(undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Skill deletion failed:", message);
      return fail("delete_error", message);
    }
  }

  function assignToAgent(
    companyId: string,
    agentId: string,
    skillId: string,
  ): DesktopResult<void> {
    const skill = db.getCompanySkill(companyId, skillId);
    if (!skill) return fail("not_found", `Skill ${skillId} not found for company`);
    db.assignSkillToAgent(agentId, skillId);
    return ok(undefined);
  }

  function removeFromAgent(
    _companyId: string,
    agentId: string,
    skillId: string,
  ): DesktopResult<void> {
    db.removeSkillFromAgent(agentId, skillId);
    return ok(undefined);
  }

  async function checkUpdateStatus(
    companyId: string,
    skillId: string,
  ): Promise<DesktopResult<SkillUpdateStatus>> {
    const skill = db.getCompanySkill(companyId, skillId);
    if (!skill) return fail("not_found", `Skill ${skillId} not found`);

    // Only GitHub/skills_sh sources support update checks
    if (skill.sourceType !== "github" && skill.sourceType !== "skills_sh") {
      return ok({
        skillId: skill.id,
        key: skill.key,
        currentRef: skill.sourceRef,
        latestRef: null,
        hasUpdate: false,
      });
    }

    // Parse owner/repo from metadata
    const metadata = skill.metadata;
    const owner = typeof metadata?.owner === "string" ? metadata.owner : null;
    const repo = typeof metadata?.repo === "string" ? metadata.repo : null;

    if (!owner || !repo) {
      // Try to parse from sourceLocator URL
      const ghParsed = skill.sourceLocator ? parseGitHubUrl(skill.sourceLocator) : null;
      if (!ghParsed) {
        return ok({
          skillId: skill.id,
          key: skill.key,
          currentRef: skill.sourceRef,
          latestRef: null,
          hasUpdate: false,
        });
      }
      const latestRef = await resolveGitHubCommitSha(ghParsed.owner, ghParsed.repo, undefined, logger);
      return ok({
        skillId: skill.id,
        key: skill.key,
        currentRef: skill.sourceRef,
        latestRef,
        hasUpdate: latestRef != null && latestRef !== skill.sourceRef,
      });
    }

    const trackingRef = typeof metadata?.trackingRef === "string" ? metadata.trackingRef : undefined;
    const latestRef = await resolveGitHubCommitSha(owner, repo, trackingRef, logger);

    return ok({
      skillId: skill.id,
      key: skill.key,
      currentRef: skill.sourceRef,
      latestRef,
      hasUpdate: latestRef != null && latestRef !== skill.sourceRef,
    });
  }

  /**
   * Build the list of RuntimeSkillEntry for adapter injection.
   * Applies token budget enforcement: skills sorted by creation date,
   * accumulated until budget exceeded, then skipped with warning.
   */
  function listRuntimeSkillEntries(
    companyId: string,
    agentId: string,
    adapterType: string,
  ): RuntimeSkillEntry[] {
    const allSkills = db.listCompanySkills(companyId);
    const agentAssignments = db.listAgentSkillAssignments(agentId);
    const skills = allSkills.filter((s) => agentAssignments.includes(s.id));

    // Sort by creation date (oldest first -- first imported gets priority)
    const sorted = [...skills].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt),
    );

    const budget = TOKEN_BUDGETS[adapterType] ?? 30000;
    let accumulated = 0;
    const entries: RuntimeSkillEntry[] = [];

    for (const skill of sorted) {
      const tokenEstimate = estimateTokens(skill.markdown);
      if (accumulated + tokenEstimate > budget) {
        logger.warn(
          `Token budget exceeded for ${adapterType}: skipping skill "${skill.name}" (${tokenEstimate} tokens, budget ${budget}, used ${accumulated})`,
        );
        continue;
      }
      accumulated += tokenEstimate;
      entries.push({
        runtimeName: skill.slug,
        sourcePath: skillFilesDir(companyId, skill.slug),
        name: skill.name,
        tokenEstimate,
      });
    }

    return entries;
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

  /**
   * Scan all workspace local paths for a company, looking for
   * `.agents/skills/` directories containing SKILL.md files.
   * Auto-imports any found skills that are not already in the database.
   * Cross-platform: uses path.join for correct separators.
   */
  async function scanWorkspaceSkills(
    companyId: string,
  ): Promise<SkillImportResult[]> {
    const allResults: SkillImportResult[] = [];

    // 1. Scan user home directories: ~/.agents/skills/ and ~/.claude/skills/
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    if (homeDir) {
      const homeScanDirs = [
        join(homeDir, ".agents", "skills"),
        join(homeDir, ".claude", "skills"),
      ];
      for (const scanDir of homeScanDirs) {
        if (!existsSync(scanDir)) continue;
        try {
          const stat = statSync(scanDir);
          if (!stat.isDirectory()) continue;
          const results = await importFromLocal(companyId, scanDir);
          allResults.push(...results);
          logger.info(`Scanned home skills: ${scanDir} — imported ${results.length} skill(s)`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn(`Failed to scan home skills at ${scanDir}: ${message}`);
        }
      }
    }

    // 2. Scan workspace .agents/skills/ directories
    const workspacePaths = db.listWorkspaceLocalPaths(companyId);
    for (const wsPath of workspacePaths) {
      const agentsSkillsDir = join(wsPath, ".agents", "skills");
      if (!existsSync(agentsSkillsDir)) continue;

      try {
        const stat = statSync(agentsSkillsDir);
        if (!stat.isDirectory()) continue;

        const results = await importFromLocal(companyId, agentsSkillsDir);
        allResults.push(...results);
        logger.info(
          `Scanned workspace skills: ${agentsSkillsDir} — imported ${results.length} skill(s)`,
        );
      } catch (err) {
        // Log but don't fail the entire scan if one workspace has issues
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`Failed to scan workspace skills at ${agentsSkillsDir}: ${message}`);
      }
    }

    return allResults;
  }

  return {
    importFromSource,
    importFromGitHub,
    importFromLocal,
    importFromUrl,
    listForCompany,
    getDetail,
    deleteSkill,
    assignToAgent,
    removeFromAgent,
    checkUpdateStatus,
    listRuntimeSkillEntries,
    scanWorkspaceSkills,
  };
}
