import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AppDatabase } from "../database";
import type { SkillImportResult, RuntimeSkillEntry } from "../skill-types.js";
import { estimateTokens, parseFrontmatterMarkdown, extractRuntimeSemantics } from "../skill-format.js";
import { resolveTokenBudget } from "../skill-types.js";

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

    const sorted = [...skills].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt),
    );

    const budget = resolveTokenBudget(adapterType);
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

      const { frontmatter } = parseFrontmatterMarkdown(skill.markdown);
      const semantics = extractRuntimeSemantics(frontmatter);

      entries.push({
        runtimeName: skill.slug,
        sourcePath: skillFilesDir(companyId, skill.slug),
        name: skill.name,
        tokenEstimate,
        allowedTools: semantics.allowedTools,
        hooks: semantics.hooks,
        contextMode: semantics.contextMode,
        isAgent: semantics.isAgent,
        effort: semantics.effort,
        whenToUse: semantics.whenToUse,
      });
    }

    return entries;
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
        try { return statSyncLocal(join(builtinDir, name)).isDirectory(); } catch { return false; }
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
          } catch { /* non-fatal metadata update */ }
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

  function assignBasicSkillsToAgent(companyId: string, agentId: string): number {
    const allSkills = db.listCompanySkills(companyId);
    let assigned = 0;
    for (const skill of allSkills) {
      try {
        const meta = skill.metadata ? JSON.parse(typeof skill.metadata === "string" ? skill.metadata : JSON.stringify(skill.metadata)) : {};
        if (meta.builtinCategory === "basic-for-all") {
          db.assignSkillToAgent(agentId, skill.id);
          assigned++;
        }
      } catch { /* skip malformed metadata */ }
    }
    return assigned;
  }

  function assignRoleSkillsToAgent(companyId: string, agentId: string, role: string, department?: string | null): number {
    const allSkills = db.listCompanySkills(companyId);
    let assigned = 0;

    const roleCategories: Record<string, string[]> = {
      ceo: ["basic-for-all", "software-engineer", "document-process", "frontend-design", "marketing", "iOS-Dev", "my-writing-style", "Video-maker"],
      engineer: ["basic-for-all", "software-engineer"],
      designer: ["basic-for-all", "frontend-design"],
      marketing: ["basic-for-all", "marketing", "my-writing-style"],
      writer: ["basic-for-all", "document-process", "my-writing-style"],
      ios: ["basic-for-all", "software-engineer", "iOS-Dev"],
      mobile: ["basic-for-all", "software-engineer", "iOS-Dev"],
      video: ["basic-for-all", "Video-maker"],
      frontend: ["basic-for-all", "software-engineer", "frontend-design"],
    };

    const normalizedRole = role.toLowerCase();
    const normalizedDept = department?.toLowerCase() ?? "";

    let categories = roleCategories[normalizedRole] ?? ["basic-for-all"];

    for (const [key, cats] of Object.entries(roleCategories)) {
      if (normalizedDept.includes(key) || normalizedRole.includes(key)) {
        categories = [...new Set([...categories, ...cats])];
      }
    }

    if (normalizedRole === "ceo" || normalizedRole.includes("chief")) {
      categories = roleCategories.ceo ?? ["basic-for-all"];
    }

    for (const skill of allSkills) {
      try {
        const meta = skill.metadata ? JSON.parse(typeof skill.metadata === "string" ? skill.metadata : JSON.stringify(skill.metadata)) : {};
        if (meta.builtinCategory && categories.includes(meta.builtinCategory)) {
          db.assignSkillToAgent(agentId, skill.id);
          assigned++;
        }
      } catch { /* skip */ }
    }
    return assigned;
  }

  return {
    listRuntimeSkillEntries,
    scanWorkspaceSkills,
    seedBuiltinSkills,
    assignBasicSkillsToAgent,
    assignRoleSkillsToAgent,
  };
}
