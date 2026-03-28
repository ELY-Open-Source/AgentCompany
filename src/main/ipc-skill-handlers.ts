import {
  IPC_CHANNELS,
  importSkillSchema,
  listSkillsSchema,
  getSkillDetailSchema,
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
  "registerHandle" | "ensureCompanyExists" | "publishDomainChanged"
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
}: SkillHandlerDependencies) {
  function requireSkillService() {
    if (!skillService) {
      return fail("SERVICE_NOT_READY", "Skill service is not initialized.");
    }
    return null;
  }

  // ---- Import skill from source (GitHub URL, local path, raw URL, skills.sh) ----
  registerHandle(IPC_CHANNELS.importSkill, async (_event, payload) => {
    const parsed = importSkillSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const serviceError = requireSkillService();
    if (serviceError) return serviceError;
    const result = await skillService!.importFromSource(parsed.companyId, parsed.source);
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
    const serviceError = requireSkillService();
    if (serviceError) return serviceError;
    // Scan workspace .agents/skills/ directories for new skills before listing
    try {
      await skillService!.scanWorkspaceSkills(parsed.companyId);
    } catch {
      // Non-fatal: scan failure should not block listing existing skills
    }
    return ok(skillService!.listForCompany(parsed.companyId));
  });

  // ---- Get skill detail ----
  registerHandle(IPC_CHANNELS.getSkillDetail, async (_event, payload) => {
    const parsed = getSkillDetailSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const serviceError = requireSkillService();
    if (serviceError) return serviceError;
    return skillService!.getDetail(parsed.companyId, parsed.skillId);
  });

  // ---- Delete a skill ----
  registerHandle(IPC_CHANNELS.deleteSkill, async (_event, payload) => {
    const parsed = deleteSkillSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const serviceError = requireSkillService();
    if (serviceError) return serviceError;
    const result = await skillService!.deleteSkill(parsed.companyId, parsed.skillId);
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
    const serviceError = requireSkillService();
    if (serviceError) return serviceError;
    const result = skillService!.assignToAgent(parsed.companyId, parsed.agentId, parsed.skillId);
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
    const serviceError = requireSkillService();
    if (serviceError) return serviceError;
    const result = skillService!.removeFromAgent(parsed.companyId, parsed.agentId, parsed.skillId);
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
    const serviceError = requireSkillService();
    if (serviceError) return serviceError;
    return skillService!.checkUpdateStatus(parsed.companyId, parsed.skillId);
  });

  // ---- List agent IDs assigned to a skill ----
  registerHandle(IPC_CHANNELS.listSkillAgents, async (_event, payload) => {
    const parsed = listSkillAgentsSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    return ok(db.listSkillAgentAssignments(parsed.skillId));
  });

  // ---- List skill IDs assigned to an agent ----
  registerHandle(IPC_CHANNELS.listAgentSkills, async (_event, payload) => {
    const parsed = listAgentSkillsSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    return ok(db.listAgentSkillAssignments(parsed.agentId));
  });
}
