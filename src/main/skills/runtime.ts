import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadSkills } from "@mariozechner/pi-coding-agent";
import type { AppDatabase } from "../database";
import type { SkillImportResult, ProjectedSkill } from "../skill-types.js";

interface RuntimeDeps {
  db: AppDatabase;
  profileDir: string;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  skillsRoot: (companyId: string) => string;
  skillFilesDir: (companyId: string, slug: string) => string;
  importFromLocal: (companyId: string, localPath: string) => Promise<SkillImportResult[]>;
}

export function createSkillRuntime({ db, logger, skillsRoot, skillFilesDir, importFromLocal }: RuntimeDeps) {
  /**
   * Project all company skills through pi-coding-agent's progressive-disclosure
   * loader. Every agent in the company sees the full catalog — descriptions
   * only, full SKILL.md loaded on-demand by the agent via the `read` tool.
   *
   * The agentId / connectorId parameters are retained for signature
   * compatibility with the orchestrator but are intentionally unused: pi's
   * model has no per-agent filtering and no per-connector token budget.
   */
  function listRuntimeSkillEntries(
    companyId: string,
    _agentId: string,
    _connectorId: string,
  ): ProjectedSkill[] {
    const companySkills = db.listCompanySkills(companyId);
    const skillPaths = companySkills.map((s) => skillFilesDir(companyId, s.slug));
    const { skills, diagnostics } = loadSkills({ skillPaths, includeDefaults: false });

    for (const diag of diagnostics) {
      if (diag.type === "warning") {
        logger.warn(`[skills] ${diag.message} (${diag.path})`);
      }
    }

    return skills.map((s) => ({
      name: s.name,
      description: s.description,
      filePath: s.filePath,
      baseDir: s.baseDir,
    }));
  }

  /**
   * Scan all workspace local paths for a company, looking for
   * `.agentcompany/skills/` directories containing SKILL.md files.
   */
  async function scanWorkspaceSkills(
    companyId: string,
  ): Promise<SkillImportResult[]> {
    const allResults: SkillImportResult[] = [];

    const profileSkillsDir = skillsRoot(companyId);
    if (existsSync(profileSkillsDir)) {
      try {
        const stat = statSync(profileSkillsDir);
        if (stat.isDirectory()) {
          const results = await importFromLocal(companyId, profileSkillsDir);
          allResults.push(...results);
          logger.info(`Scanned profile skills: ${profileSkillsDir} — imported ${results.length} skill(s)`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`Failed to scan profile skills at ${profileSkillsDir}: ${message}`);
      }
    }

    const workspacePaths = db.listWorkspaceLocalPaths(companyId);
    for (const wsPath of workspacePaths) {
      const agentcompanySkillsDir = join(wsPath, ".agentcompany", "skills");
      if (!existsSync(agentcompanySkillsDir)) continue;

      try {
        const stat = statSync(agentcompanySkillsDir);
        if (!stat.isDirectory()) continue;

        const results = await importFromLocal(companyId, agentcompanySkillsDir);
        allResults.push(...results);
        logger.info(
          `Scanned workspace skills: ${agentcompanySkillsDir} — imported ${results.length} skill(s)`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`Failed to scan workspace skills at ${agentcompanySkillsDir}: ${message}`);
      }
    }

    return allResults;
  }

  function getBuiltinSkillsDir(): string | null {
    if (process.resourcesPath) {
      const resourcesPath = join(process.resourcesPath, "builtin-skills");
      if (existsSync(resourcesPath)) return resourcesPath;
    }
    const cwdPath = join(process.cwd(), "builtin-skills");
    if (existsSync(cwdPath)) return cwdPath;
    return null;
  }

  async function seedBuiltinSkills(companyId: string): Promise<SkillImportResult[]> {
    const builtinDir = getBuiltinSkillsDir();
    if (!builtinDir) {
      logger.warn("[skills] Builtin skills directory not found — skipping seed.");
      return [];
    }

    const allResults: SkillImportResult[] = [];

    let categories: string[];
    try {
      const { readdirSync, statSync: statSyncLocal } = await import("node:fs");
      categories = readdirSync(builtinDir).filter(name => {
        if (name.startsWith(".")) return false;
        try {
          return statSyncLocal(join(builtinDir, name)).isDirectory();
        } catch (error) {
          logger.warn(
            `[skills] statSync failed for builtin entry ${name}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return false;
        }
      });
    } catch {
      logger.warn(`[skills] Failed to read builtin skills directory: ${builtinDir}`);
      return [];
    }

    for (const category of categories) {
      const categoryDir = join(builtinDir, category);
      try {
        const results = await importFromLocal(companyId, categoryDir);
        for (const result of results) {
          try {
            const skill = db.getCompanySkill(companyId, result.skillId);
            if (skill) {
              const existingMeta = skill.metadata ? JSON.parse(typeof skill.metadata === "string" ? skill.metadata : JSON.stringify(skill.metadata)) : {};
              existingMeta.builtinCategory = category;
              existingMeta.sourceKind = "builtin";
              db.updateCompanySkillMetadata(companyId, result.skillId, JSON.stringify(existingMeta));
            }
          } catch (error) {
            logger.warn(
              `[skills] metadata update failed for skill ${result.skillId} (category ${category}): ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        allResults.push(...results);
        logger.info(`[skills] Seeded ${results.length} builtin skill(s) from category: ${category}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`[skills] Failed to seed builtin category ${category}: ${message}`);
      }
    }

    return allResults;
  }

  return {
    listRuntimeSkillEntries,
    scanWorkspaceSkills,
    seedBuiltinSkills,
  };
}
