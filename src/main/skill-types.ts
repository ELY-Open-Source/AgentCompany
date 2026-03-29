/**
 * Source type for a skill -- matches the company_skills.source_type column.
 */
export type SkillSourceType =
  | "github"
  | "local_path"
  | "url"
  | "skills_sh"
  | "managed";

/**
 * Trust level derived from the file inventory of a skill package.
 * Determines what content is injected and how cautiously.
 */
export type TrustLevel =
  | "markdown_only"
  | "assets"
  | "scripts_executables";

/**
 * A single file entry within a skill package inventory.
 */
export interface FileInventoryEntry {
  path: string;
  kind: "skill" | "reference" | "script" | "asset" | "markdown" | "other";
}

/**
 * Full row interface matching the company_skills table.
 * Property names use camelCase (JS convention) even though DB columns are snake_case.
 */
export interface SkillRecord {
  id: string;
  companyId: string;
  key: string;
  slug: string;
  name: string;
  description: string | null;
  markdown: string;
  sourceType: SkillSourceType;
  sourceLocator: string | null;
  sourceRef: string | null;
  trustLevel: TrustLevel;
  compatibility: string;
  fileInventory: FileInventoryEntry[];
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Result returned after importing or updating a skill.
 */
export interface SkillImportResult {
  skillId: string;
  key: string;
  name: string;
  isUpdate: boolean;
}

/**
 * Runtime representation of a skill entry for adapter injection.
 */
export interface RuntimeSkillEntry {
  runtimeName: string;
  sourcePath: string;
  name: string;
  tokenEstimate: number;
}

/**
 * Minimal skill reference passed to worker threads.
 * Subset of RuntimeSkillEntry to minimize serialization overhead.
 */
export interface ManagedSkillRef {
  runtimeName: string;
  sourcePath: string;
}

/**
 * Skill-to-agent assignment record.
 */
export interface SkillAssignment {
  agentId: string;
  skillId: string;
}

/**
 * Update status for a skill -- used to check if a newer version is available.
 */
export interface SkillUpdateStatus {
  skillId: string;
  key: string;
  currentRef: string | null;
  latestRef: string | null;
  hasUpdate: boolean;
}

/**
 * Per-adapter token budgets for skill content injection.
 * Values represent the maximum token count of skill content that can be
 * included in a single prompt for each adapter type.
 */
export const TOKEN_BUDGETS: Readonly<Record<string, number>> = {
  claude_local: 50000,
  codex_local: 30000,
  gemini_local: 50000,
  opencode_local: 30000,
  kimi_local: 20000,
};
