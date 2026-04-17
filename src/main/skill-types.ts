// Re-export shared types that were previously duplicated here.
// Canonical definitions live in @shared/types (records-core.ts & enums.ts).
export type { SkillSourceType, TrustLevel, FileInventoryEntry, SkillRecord, SkillImportResult, SkillUpdateStatus } from "@shared/types";

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
 * Default token budget used when a connector does not declare an override.
 */
const DEFAULT_TOKEN_BUDGET = 30000;

/**
 * Per-connector token budgets for skill content injection.
 * Values represent the maximum token count of skill content that can be
 * included in a single prompt for a given connector.
 */
export const TOKEN_BUDGETS: Readonly<Record<string, number>> = {
  // High-context Anthropic-style connectors run with a larger injection budget.
  "claude-pro": 50000,
  "anthropic": 50000,
  "amazon-bedrock": 50000,
  "gemini-cli": 50000,
  "google": 50000,
  "google-vertex": 50000,
};

/**
 * Resolves the token budget for a given connector id.
 */
export function resolveTokenBudget(connectorId: string): number {
  return TOKEN_BUDGETS[connectorId] ?? DEFAULT_TOKEN_BUDGET;
}
