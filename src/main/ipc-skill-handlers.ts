import { join } from "node:path";
import { readFile } from "node:fs/promises";
import {
  IPC_CHANNELS,
  importSkillSchema,
  listSkillsSchema,
  getSkillDetailSchema,
  getSkillMarkdownSchema,
  deleteSkillSchema,
  assignSkillToAgentSchema,
  removeSkillFromAgentSchema,
  checkSkillUpdateSchema,
  listSkillAgentsSchema,
  listAgentSkillsSchema,
} from "@shared/contracts";
import { fail, ok, type RegisterDomainHandlersDependencies } from "./ipc-domain-common";
import type { createSkillService } from "./skill-service";
import type { AppDatabase } from "./database";

interface SkillHandlerDependencies extends Pick<
  RegisterDomainHandlersDependencies,
  "registerHandle" | "ensureCompanyExists" | "publishDomainChanged" | "logger"
> {
  skillService: ReturnType<typeof createSkillService> | null;
  db: AppDatabase;
}

export function registerSkillHandlers({
  registerHandle,
  ensureCompanyExists,
  publishDomainChanged,
  skillService,
  db,
  logger,
}: SkillHandlerDependencies) {
  function requireSkillService():
    | { service: NonNullable<typeof skillService>; error?: undefined }
    | { service?: undefined; error: ReturnType<typeof fail> } {
    if (!skillService) {
      return { error: fail("SERVICE_NOT_READY", "Skill service is not initialized.") };
    }
    return { service: skillService };
  }

  // ---- Import skill from source (GitHub URL, local path, raw URL, skills.sh) ----
  registerHandle(IPC_CHANNELS.importSkill, async (_event, payload) => {
    const parsed = importSkillSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const svcResult = requireSkillService();
    if (svcResult.error) return svcResult.error;
    const svc = svcResult.service;
    const result = await svc.importFromSource(parsed.companyId, parsed.source);
    if (result.ok) {
      publishDomainChanged();
    }
    return result;
  });

  // ---- List all skills for a company (also scans workspace .agents/skills/) ----
  registerHandle(IPC_CHANNELS.listSkills, async (_event, payload) => {
    const parsed = listSkillsSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const svcResult = requireSkillService();
    if (svcResult.error) return svcResult.error;
    const svc = svcResult.service;
    // Scan workspace .agents/skills/ directories for new skills before listing
    try {
      await svc.scanWorkspaceSkills(parsed.companyId);
    } catch (err) {
      logger.warn(`[ipc/skills] scanWorkspaceSkills failed for company ${parsed.companyId}:`, err instanceof Error ? err.message : String(err));
    }
    return ok(svc.listForCompany(parsed.companyId));
  });

  // ---- Get skill detail ----
  registerHandle(IPC_CHANNELS.getSkillDetail, async (_event, payload) => {
    const parsed = getSkillDetailSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const svcResult = requireSkillService();
    if (svcResult.error) return svcResult.error;
    const svc = svcResult.service;
    return svc.getDetail(parsed.companyId, parsed.skillId);
  });

  // ---- Read SKILL.md body live from disk ----
  registerHandle(IPC_CHANNELS.getSkillMarkdown, async (_event, payload) => {
    const parsed = getSkillMarkdownSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const svcResult = requireSkillService();
    if (svcResult.error) return svcResult.error;
    const svc = svcResult.service;
    const dir = svc.skillFilesDir(parsed.companyId, parsed.slug);
    const path = join(dir, "SKILL.md");
    try {
      const content = await readFile(path, "utf-8");
      return ok(content);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        return fail("SKILL_NOT_FOUND", `SKILL.md not found at ${path}`);
      }
      return fail("SKILL_READ_FAILED", e.message ?? String(err));
    }
  });

  // ---- Delete a skill ----
  registerHandle(IPC_CHANNELS.deleteSkill, async (_event, payload) => {
    const parsed = deleteSkillSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const svcResult = requireSkillService();
    if (svcResult.error) return svcResult.error;
    const svc = svcResult.service;
    const result = await svc.deleteSkill(parsed.companyId, parsed.skillId);
    if (result.ok) {
      publishDomainChanged();
    }
    return result;
  });

  // ---- Assign skill to agent ----
  registerHandle(IPC_CHANNELS.assignSkillToAgent, async (_event, payload) => {
    const parsed = assignSkillToAgentSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const svcResult = requireSkillService();
    if (svcResult.error) return svcResult.error;
    const svc = svcResult.service;
    const result = svc.assignToAgent(parsed.companyId, parsed.agentId, parsed.skillId);
    if (result.ok) {
      publishDomainChanged();
    }
    return result;
  });

  // ---- Remove skill from agent ----
  registerHandle(IPC_CHANNELS.removeSkillFromAgent, async (_event, payload) => {
    const parsed = removeSkillFromAgentSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const svcResult = requireSkillService();
    if (svcResult.error) return svcResult.error;
    const svc = svcResult.service;
    const result = svc.removeFromAgent(parsed.companyId, parsed.agentId, parsed.skillId);
    if (result.ok) {
      publishDomainChanged();
    }
    return result;
  });

  // ---- Check if skill has update available ----
  registerHandle(IPC_CHANNELS.checkSkillUpdate, async (_event, payload) => {
    const parsed = checkSkillUpdateSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const svcResult = requireSkillService();
    if (svcResult.error) return svcResult.error;
    const svc = svcResult.service;
    return svc.checkUpdateStatus(parsed.companyId, parsed.skillId);
  });

  // ---- List agent IDs assigned to a skill ----
  registerHandle(IPC_CHANNELS.listSkillAgents, async (_event, payload) => {
    const parsed = listSkillAgentsSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.core.skills.getCompanySkill(parsed.companyId, parsed.skillId)) {
      return fail("not_found", `Skill ${parsed.skillId} not found`);
    }
    return ok(db.core.skills.listSkillAgentAssignments(parsed.companyId, parsed.skillId));
  });

  // ---- List skill IDs assigned to an agent ----
  registerHandle(IPC_CHANNELS.listAgentSkills, async (_event, payload) => {
    const parsed = listAgentSkillsSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.core.settings.belongsToCompany("agents", parsed.agentId, parsed.companyId)) {
      return fail("not_found", `Agent ${parsed.agentId} not found`);
    }
    return ok(db.core.skills.listAgentSkillAssignments(parsed.companyId, parsed.agentId));
  });
}
