/**
 * Role-classification helpers used across prompt construction and skill
 * auto-assignment. Historical keyword match remains here for backfill and
 * UI-free fallback; typed `agent.roleLevel` is the source of truth once the
 * column is populated.
 *
 * Matching uses word-boundary tokenization instead of substring search,
 * so "lead" does not match "cleaner" or "leaderboard".
 */
import type { AgentRoleLevel } from "@shared/types";
import { isLeadershipLevel } from "@shared/types";

export const LEADERSHIP_ROLE_KEYWORDS = [
  "chief",
  "cto",
  "cmo",
  "coo",
  "cfo",
  "ceo",
  "vp",
  "vice",
  "president",
  "head",
  "director",
  "manager",
  "lead",
] as const;

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

export function roleMatchesLeadershipKeywords(role: string, title?: string | null): boolean {
  const tokens = new Set(tokenize(`${role} ${title ?? ""}`));
  return LEADERSHIP_ROLE_KEYWORDS.some((keyword) => tokens.has(keyword));
}

/**
 * One-shot inference from free-text role/title strings. Used when creating or
 * backfilling an agent so `roleLevel` can be stored once and re-read cheaply.
 * The most specific token wins; order here is most-senior → least.
 */
export function inferRoleLevel(role: string, title?: string | null): AgentRoleLevel {
  const tokens = new Set(tokenize(`${role} ${title ?? ""}`));
  if (tokens.has("ceo") || tokens.has("cto") || tokens.has("cmo") || tokens.has("coo") || tokens.has("cfo") || tokens.has("chief")) {
    return "c_suite";
  }
  if (tokens.has("vp") || tokens.has("vice") || tokens.has("president")) return "vp";
  if (tokens.has("director") || tokens.has("head")) return "director";
  if (tokens.has("manager")) return "manager";
  if (tokens.has("lead")) return "lead";
  return "ic";
}

/** Canonical leadership check: typed enum wins, fallback to keyword match. */
export function agentIsLeader(agent: { roleLevel?: AgentRoleLevel | null; role: string; title: string | null }): boolean {
  if (agent.roleLevel) return isLeadershipLevel(agent.roleLevel);
  return roleMatchesLeadershipKeywords(agent.role, agent.title);
}
