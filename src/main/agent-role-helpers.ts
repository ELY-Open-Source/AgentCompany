/**
 * Role-classification helpers used across prompt construction and skill
 * auto-assignment. Keeping a single keyword list here prevents drift
 * between system-prompt.ts and automation-skills.ts.
 *
 * Matching uses word-boundary tokenization instead of substring search,
 * so "lead" does not match "cleaner" or "leaderboard".
 */

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
