import type { AppDatabase } from "../database";
import type { DesktopResult } from "@shared/contracts";
import type { SkillRecord, SkillUpdateStatus } from "../skill-types.js";
import { resolveGitHubCommitSha } from "../skill-github.js";

interface CrudDeps {
  db: AppDatabase;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  cleanupSkillFiles: (companyId: string, slug: string) => Promise<void>;
  parseGitHubUrl: (url: string) => { owner: string; repo: string } | null;
}

export function createSkillCrud({ db, logger, cleanupSkillFiles, parseGitHubUrl }: CrudDeps) {
  function ok<T>(data: T): DesktopResult<T> {
    return { ok: true, data };
  }
  function fail(code: string, message: string): DesktopResult<never> {
    return { ok: false, error: { code, message } };
  }

  function listForCompany(companyId: string): SkillRecord[] {
    return db.core.skills.listCompanySkills(companyId);
  }

  function getDetail(companyId: string, skillId: string): DesktopResult<SkillRecord> {
    const skill = db.core.skills.getCompanySkill(companyId, skillId);
    if (!skill) return fail("not_found", `Skill ${skillId} not found`);
    return ok(skill);
  }

  async function deleteSkill(
    companyId: string,
    skillId: string,
  ): Promise<DesktopResult<void>> {
    const skill = db.core.skills.getCompanySkill(companyId, skillId);
    if (!skill) return fail("not_found", `Skill ${skillId} not found`);

    try {
      await cleanupSkillFiles(companyId, skill.slug);
      db.core.skills.deleteCompanySkill(companyId, skillId);
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
    const skill = db.core.skills.getCompanySkill(companyId, skillId);
    if (!skill) return fail("not_found", `Skill ${skillId} not found for company`);
    if (!db.core.skills.assignSkillToAgent(companyId, agentId, skillId)) {
      return fail("not_found", `Agent ${agentId} not found for company`);
    }
    return ok(undefined);
  }

  function removeFromAgent(
    companyId: string,
    agentId: string,
    skillId: string,
  ): DesktopResult<void> {
    if (!db.core.skills.removeSkillFromAgent(companyId, agentId, skillId)) {
      return fail("not_found", `Skill assignment not found for company`);
    }
    return ok(undefined);
  }

  async function checkUpdateStatus(
    companyId: string,
    skillId: string,
  ): Promise<DesktopResult<SkillUpdateStatus>> {
    const skill = db.core.skills.getCompanySkill(companyId, skillId);
    if (!skill) return fail("not_found", `Skill ${skillId} not found`);

    if (skill.sourceType !== "github" && skill.sourceType !== "skills_sh") {
      return ok({
        skillId: skill.id,
        key: skill.key,
        currentRef: skill.sourceRef,
        latestRef: null,
        hasUpdate: false,
      });
    }

    const metadata = skill.metadata;
    const owner = typeof metadata?.owner === "string" ? metadata.owner : null;
    const repo = typeof metadata?.repo === "string" ? metadata.repo : null;

    if (!owner || !repo) {
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

  return { listForCompany, getDetail, deleteSkill, assignToAgent, removeFromAgent, checkUpdateStatus };
}
