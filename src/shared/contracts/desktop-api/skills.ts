import type { SkillImportResult, SkillRecord, SkillUpdateStatus } from "../../types";
import type { DesktopResult } from "./common";

export type SkillsApi = {
  importSkill: (companyId: string, source: string) => Promise<DesktopResult<SkillImportResult[]>>;
  listSkills: (companyId: string) => Promise<DesktopResult<SkillRecord[]>>;
  getSkillDetail: (companyId: string, skillId: string) => Promise<DesktopResult<SkillRecord>>;
  deleteSkill: (companyId: string, skillId: string) => Promise<DesktopResult<void>>;
  assignSkillToAgent: (companyId: string, agentId: string, skillId: string) => Promise<DesktopResult<void>>;
  removeSkillFromAgent: (companyId: string, agentId: string, skillId: string) => Promise<DesktopResult<void>>;
  checkSkillUpdate: (companyId: string, skillId: string) => Promise<DesktopResult<SkillUpdateStatus>>;
  listSkillAgents: (companyId: string, skillId: string) => Promise<DesktopResult<string[]>>;
  listAgentSkills: (companyId: string, agentId: string) => Promise<DesktopResult<string[]>>;
};
