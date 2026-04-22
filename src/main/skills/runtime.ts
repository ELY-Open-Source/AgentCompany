import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadSkills } from "@mariozechner/pi-coding-agent";
import type { AppDatabase } from "../database";
import type { SkillImportResult, ProjectedSkill } from "../skill-types.js";
import { classifyUnknownError } from "../errors/index.js";

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
   * Project the agent's assigned skills through pi-coding-agent's
   * progressive-disclosure loader. Users curate skill visibility per agent
   * via `agent_skill_assignments`; runtime honors that selection by only
   * passing assigned SKILL.md directories to `loadSkills`. Pi returns
   * descriptions for the system prompt; the agent loads full SKILL.md
   * on demand via the `read` tool.
   *
   * connectorId is retained for signature compatibility and reserved for
   * future connector-specific policy (no current use).
   */
  function listRuntimeSkillEntries(
    companyId: string,
    agentId: string,
    _connectorId: string,
  ): ProjectedSkill[] {
    const assignedIds = new Set(db.core.skills.listAgentSkillAssignments(agentId));
    if (assignedIds.size === 0) return [];
    const companySkills = db.core.skills.listCompanySkills(companyId);
    const skillPaths = companySkills
      .filter((s) => assignedIds.has(s.id))
      .map((s) => skillFilesDir(companyId, s.slug));
    if (skillPaths.length === 0) return [];
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

    const workspacePaths = db.core.workspaces.listWorkspaceLocalPaths(companyId);
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
          const classified = classifyUnknownError(error, {
            kind: "recoverable",
            code: "skills.builtin.stat_failed",
            message: `statSync failed for builtin entry ${name}`,
            context: { builtinDir, entry: name },
          });
          logger.warn(`[${classified.code}] ${classified.message}: ${error instanceof Error ? error.message : String(error)}`);
          return false;
        }
      });
    } catch (err) {
      const classified = classifyUnknownError(err, {
        kind: "recoverable",
        code: "skills.builtin.readdir_failed",
        message: `Failed to read builtin skills directory`,
        context: { builtinDir },
      });
      logger.warn(`[${classified.code}] ${classified.message}: ${builtinDir}`);
      return [];
    }

    for (const category of categories) {
      const categoryDir = join(builtinDir, category);
      try {
        const results = await importFromLocal(companyId, categoryDir);
        for (const result of results) {
          try {
            const skill = db.core.skills.getCompanySkill(companyId, result.skillId);
            if (skill) {
              const existingMeta = skill.metadata ? JSON.parse(typeof skill.metadata === "string" ? skill.metadata : JSON.stringify(skill.metadata)) : {};
              existingMeta.builtinCategory = category;
              existingMeta.sourceKind = "builtin";
              db.core.skills.updateCompanySkillMetadata(companyId, result.skillId, JSON.stringify(existingMeta));
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
