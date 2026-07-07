import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { RISK_LEVEL } from "../../shared/domain";
import { loadSkillManifest, type SkillManifest } from "./skill-manifest";
import type { SkillService } from "./skill-service";

/**
 * Skills live on disk the way developers keep them: one directory per skill
 * under the user's global `~/.agents/skills` and under each workspace's
 * `.agents/skills`. A directory qualifies with either a full
 * skill.manifest.json or just a SKILL.md; for the latter the manifest is
 * derived (name from frontmatter or the directory name, SKILL.md as the
 * entrypoint). Paths are joined per platform — Windows, macOS, and Linux
 * all resolve the same way.
 */

export interface SkillSyncReport {
  imported: number;
  skipped: number;
  failures: string[];
}

export function defaultGlobalSkillsRoot(): string {
  // Same isolation seam as AGENTCOMPANY_NEW_PROFILE_DIR: tests point this at
  // a temporary directory so they never read the developer's real library.
  return process.env.AGENTCOMPANY_NEW_SKILLS_ROOT ?? join(homedir(), ".agents", "skills");
}

export function discoverSkillDirectories(workspaceRoots: string[], globalRoot: string = defaultGlobalSkillsRoot()): string[] {
  const roots = [globalRoot, ...workspaceRoots.map((root) => join(root, ".agents", "skills"))];
  const found: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, entry.name);
      if (existsSync(join(dir, "skill.manifest.json")) || existsSync(join(dir, "SKILL.md"))) {
        found.push(dir);
      }
    }
  }
  return found;
}

/** Full manifest when present; otherwise derived from SKILL.md. */
export function manifestForDirectory(directoryPath: string): SkillManifest {
  if (existsSync(join(directoryPath, "skill.manifest.json"))) {
    return loadSkillManifest(directoryPath);
  }
  const skillMd = readFileSync(join(directoryPath, "SKILL.md"), "utf8");
  return {
    name: frontmatterName(skillMd) ?? basename(directoryPath),
    version: "1.0.0",
    entrypoint: "SKILL.md",
    capabilities: [],
    requiredTools: [],
    compatibleModels: [],
    riskLevel: RISK_LEVEL.LOW,
    tests: [],
    inputs: {},
    outputs: {},
  };
}

/**
 * Imports every discovered skill the org does not already carry. Individual
 * bad directories are reported and skipped so one broken entry cannot block
 * the rest of the library.
 */
export function syncSkillsFromDisk(
  db: DatabaseSync,
  skills: SkillService,
  orgId: string,
  globalRoot: string = defaultGlobalSkillsRoot(),
): SkillSyncReport {
  const workspaceRoots = (db.prepare("select local_path from workspaces where org_id = ?").all(orgId) as Array<{ local_path: string }>)
    .map((row) => row.local_path);
  const report: SkillSyncReport = { imported: 0, skipped: 0, failures: [] };
  for (const directory of discoverSkillDirectories(workspaceRoots, globalRoot)) {
    try {
      const manifest = manifestForDirectory(directory);
      if (skills.hasSkill(orgId, manifest.name)) {
        report.skipped += 1;
        continue;
      }
      skills.importManifest(orgId, directory, manifest);
      report.imported += 1;
    } catch (error) {
      report.failures.push(`${directory}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return report;
}

function frontmatterName(markdown: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!match) return null;
  const nameLine = match[1].split(/\r?\n/).find((line) => /^name\s*:/.test(line.trim()));
  if (!nameLine) return null;
  const value = nameLine.split(":").slice(1).join(":").trim().replace(/^["']|["']$/g, "");
  return value || null;
}
