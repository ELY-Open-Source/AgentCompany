import { randomUUID } from "node:crypto";
import type { AppDatabase } from "../database";
import type { FileInventoryEntry, SkillImportResult } from "../skill-types.js";
import { parseFrontmatterMarkdown } from "../skill-format.js";
import { deriveCanonicalSkillKey, normalizeSkillSlug } from "../skill-keys.js";
import { MAX_SKILL_BYTES } from "../skill-github.js";
import { materializeSkillFiles } from "./materialize";
import { readResponseWithLimit } from "./read-response-with-limit.js";

export interface UrlImportContext {
  db: AppDatabase;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  skillFilesDir: (companyId: string, slug: string) => string;
}

export async function importFromUrl(
  ctx: UrlImportContext,
  companyId: string,
  url: string,
  safeFetch: (target: string) => Promise<Response>,
): Promise<SkillImportResult[]> {
  const { db, logger, skillFilesDir } = ctx;
  const response = await safeFetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch skill from URL: ${response.status} ${url}`);
  }
  const markdown = await readResponseWithLimit(response, MAX_SKILL_BYTES);
  const parsed = parseFrontmatterMarkdown(markdown);
  const nowTs = new Date().toISOString();

  let urlSlug: string | null = null;
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split("/").filter(Boolean);
    const lastPart = pathParts[pathParts.length - 1] ?? "";
    urlSlug = normalizeSkillSlug(lastPart.replace(/\.md$/i, ""));
  } catch (err) {
    logger.warn(`[skill-import] Unable to parse skill URL for slug derivation (${url}):`, err instanceof Error ? err.message : String(err));
  }
  const rawSlug =
    normalizeSkillSlug(parsed.frontmatter.slug as string | undefined) ??
    urlSlug ??
    "skill";

  const inventory: FileInventoryEntry[] = [
    { path: "SKILL.md", kind: "skill" },
  ];
  const trustLevel = "markdown_only" as const;

  const key = deriveCanonicalSkillKey(companyId, {
    slug: rawSlug,
    sourceType: "url",
    sourceLocator: url,
    metadata: null,
  });

  const skillId = randomUUID();
  await materializeSkillFiles(skillFilesDir(companyId, rawSlug), markdown, inventory);

  const { isUpdate } = db.core.skills.upsertCompanySkill({
    id: skillId,
    companyId,
    key,
    slug: rawSlug,
    name: (typeof parsed.frontmatter.name === "string" ? parsed.frontmatter.name : null) ?? rawSlug,
    description: typeof parsed.frontmatter.description === "string" ? parsed.frontmatter.description : null,
    sourceType: "url",
    sourceLocator: url,
    sourceRef: null,
    trustLevel,
    compatibility: "compatible",
    fileInventory: JSON.stringify(inventory),
    metadata: null,
    createdAt: nowTs,
    updatedAt: nowTs,
  });

  const results: SkillImportResult[] = [
    { skillId, key, name: rawSlug, isUpdate },
  ];
  logger.info(`Skill ${isUpdate ? "updated" : "imported"} from URL: ${key}`);
  return results;
}
