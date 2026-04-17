import type { AppDatabase } from "../database";
import type { DesktopResult } from "@shared/contracts";
import type { SkillImportResult } from "../skill-types.js";
import { parseSkillImportSource } from "../skill-keys.js";
import { createGitHubImporter } from "./import-github";
import {
  findSkillMdFiles as findSkillMdFilesImpl,
  buildLocalInventory as buildLocalInventoryImpl,
} from "./discovery";
import { cleanupSkillFilesDir } from "./materialize";
import { importFromLocal as importFromLocalImpl } from "./import-local";
import { importFromUrl as importFromUrlImpl } from "./import-url";

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
  const ctx = { db, logger, skillFilesDir };

  async function cleanupSkillFiles(companyId: string, slug: string): Promise<void> {
    await cleanupSkillFilesDir(skillFilesDir(companyId, slug));
  }

  async function importFromLocal(
    companyId: string,
    localPath: string,
  ): Promise<SkillImportResult[]> {
    return importFromLocalImpl(ctx, companyId, localPath);
  }

  async function importFromUrl(
    companyId: string,
    url: string,
    safeFetch: (target: string) => Promise<Response>,
  ): Promise<SkillImportResult[]> {
    return importFromUrlImpl(ctx, companyId, url, safeFetch);
  }

  function findSkillMdFiles(
    rootDir: string,
    opts?: { maxDepth?: number; maxFiles?: number },
  ): string[] {
    return findSkillMdFilesImpl(rootDir, logger, opts);
  }

  function buildLocalInventory(
    skillDir: string,
    skillMdPath: string,
    opts?: { maxDepth?: number; maxFiles?: number },
  ) {
    return buildLocalInventoryImpl(skillDir, skillMdPath, logger, opts);
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
        const { fetchWithSsrfProtection } = await import("./url-validation");
        const results = await importFromUrl(companyId, source, fetchWithSsrfProtection);
        return ok(results);
      }

      return fail("invalid_source", `Unrecognized skill source format: ${rawSource}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Skill import failed:", message);
      return fail("import_error", message);
    }
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
