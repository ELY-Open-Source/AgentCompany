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
 * Skill execution context mode — controls how the skill is invoked.
 * - "inline": skill content is injected into the current prompt (default)
 * - "fork": skill runs in an isolated context / sub-conversation
 */
export type SkillContextMode = "inline" | "fork";

/**
 * Runtime representation of a skill entry for adapter injection.
 * Includes strong semantic fields inspired by Reference's skill loader:
 * allowed-tools, hooks, context mode, agent flag, effort hint.
 */
export interface RuntimeSkillEntry {
  runtimeName: string;
  sourcePath: string;
  name: string;
  tokenEstimate: number;
  /** Tools this skill is allowed to use. Empty = unrestricted. */
  allowedTools: string[];
  /** Lifecycle hooks the skill registers (e.g., "on_task_start", "on_run_complete"). */
  hooks: string[];
  /** Context mode: "inline" (default) or "fork" (isolated sub-conversation). */
  contextMode: SkillContextMode;
  /** Whether this skill acts as an autonomous agent (true) or passive knowledge (false). */
  isAgent: boolean;
  /** Effort hint: "low", "medium", "high". Informs scheduling and token budget allocation. */
  effort: "low" | "medium" | "high";
  /** When this skill should be activated. Empty = always active when assigned. */
  whenToUse: string;
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
  claude_compatible: 50000,
};

/**
 * Resolves the token budget for a given adapter type.
 * Handles claude_compat_2..10 variants by mapping them to claude_compatible.
 */
export function resolveTokenBudget(adapterType: string): number {
  if (TOKEN_BUDGETS[adapterType] !== undefined) return TOKEN_BUDGETS[adapterType];
  if (adapterType.startsWith("claude_compat")) return TOKEN_BUDGETS.claude_compatible;
  return 30000;
}
