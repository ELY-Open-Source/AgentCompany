/**
 * Role-classification helpers used across prompt construction and skill
 * auto-assignment. Historical keyword match remains here for backfill and
 * UI-free fallback; typed `agent.roleLevel` is the source of truth once the
 * column is populated.
 *
 * Matching uses word-boundary tokenization instead of substring search,
 * so "lead" does not match "cleaner" or "leaderboard".
 */
import type { AgentRoleLevel, TaskDomain, TaskTier } from "@shared/types";
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
  // Unicode-safe tokenization. Matches runs of letters/numbers across
  // scripts so a Chinese title like "高级架构师" yields ["高级架构师"]
  // rather than being stripped. English tokens still tokenize on word
  // boundaries as before.
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * Check whether a keyword appears in the role/title text. For Latin
 * keywords we use whole-token equality (so "lead" does not match
 * "leaderboard"). For CJK keywords we fall back to substring containment
 * because CJK text has no explicit word boundaries — "架构师" is a
 * legitimate substring of "高级架构师" and should match.
 */
function matchesKeyword(loweredText: string, tokens: Set<string>, keyword: string): boolean {
  if (/[\u4e00-\u9fff]/.test(keyword)) {
    return loweredText.includes(keyword);
  }
  return tokens.has(keyword);
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

export interface TaskProfile {
  domain: TaskDomain;
  requiredTier: TaskTier;
}

/**
 * Ordered keyword → domain table. First match wins; order matters because
 * role strings can contain multiple cues ("research engineer" is primarily
 * a researcher, not a coder). English keywords match on whole-token
 * equality; CJK keywords (Chinese here) match on substring containment.
 * The list is intentionally narrow — anything unmatched falls through to
 * the role-level heuristic below.
 */
const DOMAIN_KEYWORDS: Array<{ keyword: string; domain: TaskDomain }> = [
  // ── Reasoning-heavy ──
  // English
  { keyword: "architect", domain: "reasoning" },
  { keyword: "reviewer", domain: "reasoning" },
  { keyword: "auditor", domain: "reasoning" },
  { keyword: "analyst", domain: "reasoning" },
  { keyword: "researcher", domain: "reasoning" },
  { keyword: "scientist", domain: "reasoning" },
  { keyword: "mathematician", domain: "reasoning" },
  { keyword: "economist", domain: "reasoning" },
  { keyword: "strategist", domain: "reasoning" },
  { keyword: "cto", domain: "reasoning" },
  { keyword: "cfo", domain: "reasoning" },
  // Chinese (CJK keywords match via substring, so "高级架构师" hits 架构师)
  { keyword: "架构师", domain: "reasoning" },
  { keyword: "审查员", domain: "reasoning" },
  { keyword: "审计", domain: "reasoning" },
  { keyword: "分析师", domain: "reasoning" },
  { keyword: "研究员", domain: "reasoning" },
  { keyword: "科学家", domain: "reasoning" },
  { keyword: "数学家", domain: "reasoning" },
  { keyword: "经济学家", domain: "reasoning" },
  { keyword: "策略师", domain: "reasoning" },
  { keyword: "首席技术", domain: "reasoning" },
  { keyword: "首席财务", domain: "reasoning" },

  // ── Coding-heavy ──
  { keyword: "engineer", domain: "coding" },
  { keyword: "developer", domain: "coding" },
  { keyword: "coder", domain: "coding" },
  { keyword: "programmer", domain: "coding" },
  { keyword: "devops", domain: "coding" },
  { keyword: "sre", domain: "coding" },
  { keyword: "工程师", domain: "coding" },
  { keyword: "开发", domain: "coding" },
  { keyword: "程序员", domain: "coding" },
  { keyword: "研发", domain: "coding" },
  { keyword: "运维", domain: "coding" },

  // ── Writing-heavy: copy / marketing / content / design / PM / HR ──
  { keyword: "writer", domain: "writing" },
  { keyword: "copywriter", domain: "writing" },
  { keyword: "marketer", domain: "writing" },
  { keyword: "marketing", domain: "writing" },
  { keyword: "content", domain: "writing" },
  { keyword: "editor", domain: "writing" },
  { keyword: "pm", domain: "writing" },
  { keyword: "designer", domain: "writing" },
  { keyword: "hr", domain: "writing" },
  { keyword: "撰稿", domain: "writing" },
  { keyword: "文案", domain: "writing" },
  { keyword: "市场", domain: "writing" },
  { keyword: "营销", domain: "writing" },
  { keyword: "内容", domain: "writing" },
  { keyword: "编辑", domain: "writing" },
  { keyword: "设计师", domain: "writing" },
  { keyword: "产品经理", domain: "writing" },
  { keyword: "运营", domain: "writing" },
  { keyword: "人力资源", domain: "writing" },
  { keyword: "人事", domain: "writing" },
];

/**
 * Keyword cues that hard-pin a role to the trivial tier regardless of the
 * role-level enum. A data-entry clerk whose `roleLevel` is `ic` runs on a
 * trivial-tier model even if the free-text title is long; an "intern
 * director" (yes, these exist) gets reviewed by their title before their
 * level. Mixed English + Chinese cues.
 */
const TRIVIAL_KEYWORDS = [
  "intern",
  "assistant",
  "clerk",
  "entry",
  "junior",
  "associate",
  "实习",
  "助理",
  "初级",
  "见习",
  "文员",
] as const;

/**
 * Map a role string + optional title to (domain, requiredTier). Both the
 * domain and the tier are conservative defaults — the picker will still
 * fall back to the CEO model if no enabled candidate clears the bar, so
 * under-classifying here is always safe.
 *
 * The CEO / c_suite cases are handled by the caller (the dispatcher has
 * access to `agent.roleLevel` and knows to pin CEO to the user-chosen
 * model). This function treats every input as a subordinate.
 */
export function inferTaskProfile(
  role: string,
  title: string | null | undefined,
  roleLevel?: AgentRoleLevel | null,
): TaskProfile {
  const loweredText = `${role} ${title ?? ""}`.toLowerCase();
  const tokens = new Set(tokenize(loweredText));

  // 1. Domain by keyword — first match wins.
  let domain: TaskDomain = "writing";
  for (const entry of DOMAIN_KEYWORDS) {
    if (matchesKeyword(loweredText, tokens, entry.keyword)) {
      domain = entry.domain;
      break;
    }
  }

  // 2. Tier is pinned trivial by explicit cues; otherwise rides role level.
  const trivialOverride = TRIVIAL_KEYWORDS.some((kw) => matchesKeyword(loweredText, tokens, kw));
  let tier: TaskTier;
  if (trivialOverride) {
    tier = "trivial";
  } else {
    switch (roleLevel) {
      case "c_suite":
      case "vp":
      case "director":
        tier = "hard";
        break;
      case "manager":
      case "lead":
        tier = "standard";
        break;
      case "ic":
      case null:
      case undefined:
      default:
        tier = "standard";
        break;
    }
  }

  return { domain, requiredTier: tier };
}
