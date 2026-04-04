import { join } from "node:path";
import type { AppDatabase } from "../database";
import { createSkillImporter } from "./import";
import { createSkillCrud } from "./crud";
import { createSkillRuntime } from "./runtime";

interface SkillServiceDependencies {
  db: AppDatabase;
  profileDir: string;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

export function createSkillService({ db, profileDir, logger }: SkillServiceDependencies) {
  function skillsRoot(companyId: string): string {
    return join(profileDir, "skills", companyId);
  }

  function skillFilesDir(companyId: string, slug: string): string {
    return join(skillsRoot(companyId), slug);
  }

  function runtimeDir(companyId: string): string {
    return join(skillsRoot(companyId), "__runtime__");
  }
  void runtimeDir; // used externally if needed

  const importer = createSkillImporter({ db, profileDir, logger, skillsRoot, skillFilesDir });
  const crud = createSkillCrud({
    db,
    logger,
    cleanupSkillFiles: importer.cleanupSkillFiles,
    parseGitHubUrl: importer.parseGitHubUrl,
  });
  const runtime = createSkillRuntime({
    db,
    profileDir,
    logger,
    skillsRoot,
    skillFilesDir,
    importFromLocal: importer.importFromLocal,
  });

  return {
    importFromSource: importer.importFromSource,
    importFromGitHub: importer.importFromGitHub,
    importFromLocal: importer.importFromLocal,
    importFromUrl: importer.importFromUrl,
    listForCompany: crud.listForCompany,
    getDetail: crud.getDetail,
    deleteSkill: crud.deleteSkill,
    assignToAgent: crud.assignToAgent,
    removeFromAgent: crud.removeFromAgent,
    checkUpdateStatus: crud.checkUpdateStatus,
    listRuntimeSkillEntries: runtime.listRuntimeSkillEntries,
    scanWorkspaceSkills: runtime.scanWorkspaceSkills,
    seedBuiltinSkills: runtime.seedBuiltinSkills,
    assignBasicSkillsToAgent: runtime.assignBasicSkillsToAgent,
    assignRoleSkillsToAgent: runtime.assignRoleSkillsToAgent,
  };
}
