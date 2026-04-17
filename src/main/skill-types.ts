// Re-export shared types that were previously duplicated here.
// Canonical definitions live in @shared/types (records-core.ts & enums.ts).
export type { SkillSourceType, TrustLevel, FileInventoryEntry, SkillRecord, SkillImportResult, SkillUpdateStatus } from "@shared/types";

/**
 * Runtime projection of a company skill, matching pi-coding-agent's progressive-
 * disclosure model: only name/description/filePath/baseDir are exposed to the
 * prompt. The full SKILL.md is loaded on-demand by the agent via the `read` tool.
 *
 * Fields mirror pi's `Skill` interface (the full Skill has sourceInfo +
 * disableModelInvocation, which we don't need to forward to the prompt layer).
 */
export interface ProjectedSkill {
  /** Skill name (Agent Skills spec: lowercase-kebab, matches parent dir). */
  name: string;
  /** Skill description shown in the prompt manifest. */
  description: string;
  /** Absolute path to the SKILL.md file. */
  filePath: string;
  /** Directory containing SKILL.md (used for relative-path resolution). */
  baseDir: string;
}

/**
 * Skill-to-agent assignment record.
 */
export interface SkillAssignment {
  agentId: string;
  skillId: string;
}
