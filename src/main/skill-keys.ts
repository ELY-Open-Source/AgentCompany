import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { SkillSourceType } from "./skill-types.js";

const SLUG_DELIM_RE = /[^a-z0-9]+/g;
const SLUG_TRIM_RE = /^-+|-+$/g;

/**
 * Normalize a value into a URL-safe slug.
 * Returns null if the value is falsy or results in an empty string.
 */
export function normalizeSkillSlug(
  value: string | undefined | null,
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed
    .toLowerCase()
    .replace(SLUG_DELIM_RE, "-")
    .replace(SLUG_TRIM_RE, "");
  return normalized.length > 0 ? normalized : null;
}

/**
 * Compute the first 10 characters of a SHA-256 hex digest.
 * Used for hash segments in canonical keys.
 */
export function hashSkillValue(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Derive a deterministic canonical key for a skill.
 *
 * Key formats by source type:
 * - GitHub/skills_sh with owner+repo: `{owner}/{repo}/{slug}`
 * - URL with sourceLocator: `url/{normalizedHost}/{hash10}/{slug}`
 * - local_path with sourceLocator: `local/{hash10 of resolved path}/{slug}`
 * - Fallback (managed or unknown): `company/{companyId}/{slug}`
 */
export function deriveCanonicalSkillKey(
  companyId: string,
  input: {
    slug: string;
    sourceType: SkillSourceType;
    sourceLocator: string | null;
    metadata: Record<string, unknown> | null;
  },
): string {
  const slug = normalizeSkillSlug(input.slug) ?? "skill";
  const metadata = isPlainRecord(input.metadata) ? input.metadata : null;

  const owner = normalizeSkillSlug(asString(metadata?.owner));
  const repo = normalizeSkillSlug(asString(metadata?.repo));

  // GitHub or skills.sh with owner/repo metadata
  if (
    (input.sourceType === "github" || input.sourceType === "skills_sh") &&
    owner &&
    repo
  ) {
    return `${owner}/${repo}/${slug}`;
  }

  // URL source with locator
  if (input.sourceType === "url") {
    const locator = asString(input.sourceLocator);
    if (locator) {
      try {
        const url = new URL(locator);
        const host = normalizeSkillSlug(url.host) ?? "url";
        return `url/${host}/${hashSkillValue(locator)}/${slug}`;
      } catch {
        return `url/unknown/${hashSkillValue(locator)}/${slug}`;
      }
    }
  }

  // Local path source with locator
  if (input.sourceType === "local_path") {
    const locator = asString(input.sourceLocator);
    if (locator) {
      return `local/${hashSkillValue(resolve(locator))}/${slug}`;
    }
  }

  // Fallback: company-scoped key
  return `company/${companyId}/${slug}`;
}

// Three-part key: org/repo/skill
const THREE_PART_KEY_RE =
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
// Two-part key: org/repo
const TWO_PART_KEY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
// skills.sh URL pattern
const SKILLS_SH_RE =
  /^https?:\/\/(?:www\.)?skills\.sh\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/([A-Za-z0-9_.-]+))?(?:[?#].*)?$/i;

export interface ParsedSkillImportSource {
  resolvedSource: string;
  requestedSkillSlug: string | null;
  originalSkillsShUrl: string | null;
}

/**
 * Parse a raw skill import source string and resolve it to a normalized form.
 *
 * Supported input formats:
 * - `owner/repo/skill` -> GitHub URL with skills.sh origin tracking
 * - `owner/repo` -> GitHub URL
 * - `https://skills.sh/owner/repo/skill` -> GitHub URL with skills.sh origin
 * - `https://github.com/owner/repo` -> pass through
 * - `/local/path` -> pass through
 */
export function parseSkillImportSource(
  rawInput: string,
): ParsedSkillImportSource {
  const trimmed = rawInput.trim();

  // Three-part key (org/repo/skill) -- originates from skills.sh registry
  if (
    !/^https?:\/\//i.test(trimmed) &&
    THREE_PART_KEY_RE.test(trimmed)
  ) {
    const [owner, repo, skillSlugRaw] = trimmed.split("/");
    return {
      resolvedSource: `https://github.com/${owner}/${repo}`,
      requestedSkillSlug: normalizeSkillSlug(skillSlugRaw),
      originalSkillsShUrl: `https://skills.sh/${owner}/${repo}/${skillSlugRaw}`,
    };
  }

  // Two-part key (org/repo) -- resolve to GitHub
  if (
    !/^https?:\/\//i.test(trimmed) &&
    TWO_PART_KEY_RE.test(trimmed)
  ) {
    return {
      resolvedSource: `https://github.com/${trimmed}`,
      requestedSkillSlug: null,
      originalSkillsShUrl: null,
    };
  }

  // skills.sh URL -> resolve to GitHub
  const skillsShMatch = trimmed.match(SKILLS_SH_RE);
  if (skillsShMatch) {
    const [, owner, repo, skillSlugRaw] = skillsShMatch;
    return {
      resolvedSource: `https://github.com/${owner}/${repo}`,
      requestedSkillSlug: skillSlugRaw
        ? normalizeSkillSlug(skillSlugRaw)
        : null,
      originalSkillsShUrl: trimmed,
    };
  }

  // Everything else -- pass through as resolvedSource
  return {
    resolvedSource: trimmed,
    requestedSkillSlug: null,
    originalSkillsShUrl: null,
  };
}
