import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RISK_LEVEL } from "../../shared/domain";
import { loadSkillManifest, type SkillManifest } from "./skill-manifest";
import type { SkillService } from "./skill-service";

/**
 * The skill catalogue ships with the app: `built-in skills/` in the repo, and
 * `resources/built-in-skills` in a packaged build. The user never manages it.
 *
 * The bundle holds two shapes:
 *  - a directory per skill with a SKILL.md (and optional skill.manifest.json),
 *    e.g. `humanizer/`;
 *  - category directories of flat one-file skills, e.g.
 *    `engineering/engineering-backend-architect.md`.
 *
 * Staging normalizes both into one library layout the import machinery
 * understands — `<libraryRoot>/<slug>/SKILL.md` — a real copy on disk, never a
 * reference back into the bundle. Import then publishes every staged skill the
 * org does not carry yet, or whose files changed, into the immutable artifact store.
 */

export interface StagedBuiltinSkill {
  slug: string;
  directory: string;
  manifest: SkillManifest;
}

export interface BuiltinSkillSyncReport {
  imported: number;
  /** Existing skills that got a new revision because the bundle changed them. */
  upgraded: number;
  skipped: number;
  /** Active skills retired because the bundle no longer carries their slug. */
  retired: number;
  failures: string[];
}

/** Test seam, same pattern as AGENTCOMPANY_NEW_PROFILE_DIR. */
export function builtinSkillsSourceOverride(): string | undefined {
  return process.env.AGENTCOMPANY_NEW_BUILTIN_SKILLS_DIR;
}

/**
 * Mirrors the bundled catalogue into the normalized on-disk library and
 * returns every staged skill. Idempotent: re-staging overwrites in place so
 * an app update refreshes the library on next launch.
 */
export function stageBuiltinSkillsLibrary(sourceRoot: string, libraryRoot: string): StagedBuiltinSkill[] {
  if (!existsSync(sourceRoot)) {
    throw new Error(`Built-in skills bundle was not found: ${sourceRoot}`);
  }
  const staged: StagedBuiltinSkill[] = [];
  const seen = new Set<string>();
  for (const entry of readdirSync(sourceRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const sourceDir = join(sourceRoot, entry.name);
    if (existsSync(join(sourceDir, "SKILL.md")) || existsSync(join(sourceDir, "skill.manifest.json"))) {
      staged.push(stageDirectorySkill(sourceDir, entry.name, libraryRoot, seen));
      continue;
    }
    staged.push(...stageCategorySkills(sourceDir, libraryRoot, seen));
  }
  // A bundle without the forced house-style skills (one per app language) is
  // a broken install, not a small catalogue. Failing here keeps the import
  // (and the mirror-retire pass) from wiping a healthy org catalogue against
  // an empty directory.
  for (const requiredSlug of ["humanizer", "humanizer-zh"]) {
    if (!seen.has(requiredSlug)) {
      throw new Error(`Built-in skills bundle at ${sourceRoot} is missing the ${requiredSlug} skill - refusing to sync a broken bundle.`);
    }
  }
  return staged;
}

/**
 * Makes the org catalogue mirror the bundle: publishes every staged skill
 * the org does not carry yet, upgrades skills whose files changed (moving
 * bindings onto the new revision), then retires active skills whose slug
 * the bundle no longer ships. Retired skills leave list_skills and stop
 * being grantable.
 */
export function importStagedSkills(skills: SkillService, orgId: string, staged: StagedBuiltinSkill[]): BuiltinSkillSyncReport {
  const report: BuiltinSkillSyncReport = { imported: 0, upgraded: 0, skipped: 0, retired: 0, failures: [] };
  for (const unit of staged) {
    try {
      if (skills.hasSkill(orgId, unit.slug)) {
        if (skills.upgradeIfChanged(orgId, unit.directory, unit.manifest, unit.slug)) report.upgraded += 1;
        else report.skipped += 1;
        continue;
      }
      skills.importManifest(orgId, unit.directory, unit.manifest, unit.slug);
      report.imported += 1;
    } catch (error) {
      report.failures.push(`${unit.slug}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  report.retired = skills.retireSkillsNotIn(orgId, staged.map((unit) => unit.slug)).length;
  return report;
}

function stageDirectorySkill(sourceDir: string, dirName: string, libraryRoot: string, seen: Set<string>): StagedBuiltinSkill {
  const slug = uniqueSlug(slugify(dirName), seen, sourceDir);
  const target = join(libraryRoot, slug);
  // Clear first so files the bundle dropped do not linger in the library.
  rmSync(target, { recursive: true, force: true });
  cpSync(sourceDir, target, { recursive: true });
  const manifest = existsSync(join(target, "skill.manifest.json"))
    ? loadSkillManifest(target)
    : manifestFromSkillMarkdown(readFileSync(join(target, "SKILL.md"), "utf8"), dirName);
  return { slug, directory: target, manifest };
}

function stageCategorySkills(categoryDir: string, libraryRoot: string, seen: Set<string>): StagedBuiltinSkill[] {
  const staged: StagedBuiltinSkill[] = [];
  for (const entry of readdirSync(categoryDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
    if (entry.name.toLowerCase() === "readme.md") continue;
    const body = readFileSync(join(categoryDir, entry.name), "utf8");
    const frontmatter = parseFrontmatter(body);
    // A category file without a name: header is documentation, not a skill.
    if (!frontmatter.name) continue;
    const stem = entry.name.replace(/\.md$/i, "");
    const slug = uniqueSlug(slugify(stem), seen, join(categoryDir, entry.name));
    const target = join(libraryRoot, slug);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "SKILL.md"), body, "utf8");
    staged.push({
      slug,
      directory: target,
      manifest: derivedManifest(frontmatter.name, frontmatter.version, frontmatter.description),
    });
  }
  return staged;
}

function manifestFromSkillMarkdown(markdown: string, fallbackName: string): SkillManifest {
  const frontmatter = parseFrontmatter(markdown);
  return derivedManifest(frontmatter.name ?? fallbackName, frontmatter.version, frontmatter.description);
}

function derivedManifest(name: string, version: string | undefined, description: string | undefined): SkillManifest {
  return {
    name,
    version: version && /^\d+\.\d+\.\d+$/.test(version) ? version : "1.0.0",
    entrypoint: "SKILL.md",
    capabilities: [],
    requiredTools: [],
    compatibleModels: [],
    riskLevel: RISK_LEVEL.LOW,
    tests: [],
    inputs: {},
    outputs: {},
    ...(description ? { description } : {}),
  };
}

interface SkillFrontmatter {
  name?: string;
  version?: string;
  description?: string;
}

/**
 * Minimal YAML-frontmatter reader for the three fields skills declare. Handles
 * inline values (`description: text`) and block scalars (`description: |`)
 * because the bundled skills use both.
 */
export function parseFrontmatter(markdown: string): SkillFrontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!match) return {};
  const lines = match[1].split(/\r?\n/);
  const result: SkillFrontmatter = {};
  for (let index = 0; index < lines.length; index += 1) {
    const field = /^(name|version|description)\s*:\s*(.*)$/.exec(lines[index]);
    if (!field) continue;
    const key = field[1] as keyof SkillFrontmatter;
    const inline = field[2].trim();
    if (inline && !/^[|>][+-]?$/.test(inline)) {
      result[key] = stripQuotes(inline);
      continue;
    }
    const block: string[] = [];
    while (index + 1 < lines.length && (/^\s+\S/.test(lines[index + 1]) || lines[index + 1].trim() === "")) {
      block.push(lines[index + 1].trim());
      index += 1;
    }
    const value = block.join(" ").replace(/\s+/g, " ").trim();
    if (value) result[key] = value;
  }
  return result;
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function uniqueSlug(slug: string, seen: Set<string>, source: string): string {
  if (!slug) throw new Error(`Built-in skill has no usable slug: ${source}`);
  if (seen.has(slug)) throw new Error(`Built-in skill slug collision: ${slug} (${source})`);
  seen.add(slug);
  return slug;
}
