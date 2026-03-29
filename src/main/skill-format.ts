import { extname } from "node:path";
import type { FileInventoryEntry, TrustLevel } from "./skill-types.js";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseYamlScalar(rawValue: string): unknown {
  const trimmed = rawValue.trim();
  if (trimmed === "") return "";
  if (trimmed === "null" || trimmed === "~") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "[]") return [];
  if (trimmed === "{}") return {};
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (
    trimmed.startsWith('"') ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("{")
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function prepareYamlLines(
  raw: string,
): Array<{ indent: number; content: string }> {
  return raw
    .split("\n")
    .map((line) => ({
      indent: line.match(/^ */)?.[0].length ?? 0,
      content: line.trim(),
    }))
    .filter((line) => line.content.length > 0 && !line.content.startsWith("#"));
}

function parseYamlBlock(
  lines: Array<{ indent: number; content: string }>,
  startIndex: number,
  indentLevel: number,
): { value: unknown; nextIndex: number } {
  let index = startIndex;
  while (index < lines.length && lines[index]!.content.length === 0)
    index += 1;
  if (index >= lines.length || lines[index]!.indent < indentLevel) {
    return { value: {}, nextIndex: index };
  }

  const isArray =
    lines[index]!.indent === indentLevel &&
    lines[index]!.content.startsWith("-");

  if (isArray) {
    const values: unknown[] = [];
    while (index < lines.length) {
      const line = lines[index]!;
      if (line.indent < indentLevel) break;
      if (line.indent !== indentLevel || !line.content.startsWith("-")) break;
      const remainder = line.content.slice(1).trim();
      index += 1;
      if (!remainder) {
        const nested = parseYamlBlock(lines, index, indentLevel + 2);
        values.push(nested.value);
        index = nested.nextIndex;
        continue;
      }
      const inlineObjectSeparator = remainder.indexOf(":");
      if (
        inlineObjectSeparator > 0 &&
        !remainder.startsWith('"') &&
        !remainder.startsWith("{") &&
        !remainder.startsWith("[")
      ) {
        const key = remainder.slice(0, inlineObjectSeparator).trim();
        const rawValue = remainder.slice(inlineObjectSeparator + 1).trim();
        const nextObject: Record<string, unknown> = {
          [key]: parseYamlScalar(rawValue),
        };
        if (index < lines.length && lines[index]!.indent > indentLevel) {
          const nested = parseYamlBlock(lines, index, indentLevel + 2);
          if (isPlainRecord(nested.value)) {
            Object.assign(nextObject, nested.value);
          }
          index = nested.nextIndex;
        }
        values.push(nextObject);
        continue;
      }
      values.push(parseYamlScalar(remainder));
    }
    return { value: values, nextIndex: index };
  }

  // Object parsing
  const record: Record<string, unknown> = {};
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.indent < indentLevel) break;
    const colonIndex = line.content.indexOf(":");
    if (colonIndex < 0) {
      index += 1;
      continue;
    }
    const key = line.content.slice(0, colonIndex).trim();
    const remainder = line.content.slice(colonIndex + 1).trim();
    index += 1;
    if (!remainder && index < lines.length && lines[index]!.indent > indentLevel) {
      const nested = parseYamlBlock(lines, index, lines[index]!.indent);
      record[key] = nested.value;
      index = nested.nextIndex;
      continue;
    }
    record[key] = parseYamlScalar(remainder);
  }
  return { value: record, nextIndex: index };
}

function parseYamlFrontmatter(raw: string): Record<string, unknown> {
  const prepared = prepareYamlLines(raw);
  if (prepared.length === 0) return {};
  const parsed = parseYamlBlock(prepared, 0, prepared[0]!.indent);
  return isPlainRecord(parsed.value) ? parsed.value : {};
}

/**
 * Parse a SKILL.md file with optional YAML frontmatter.
 * Normalizes CRLF to LF before parsing.
 */
export function parseFrontmatterMarkdown(
  raw: string,
): { frontmatter: Record<string, unknown>; body: string } {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { frontmatter: {}, body: normalized.trim() };
  }
  const closing = normalized.indexOf("\n---\n", 4);
  if (closing < 0) {
    // Check for closing delimiter at EOF (no trailing newline)
    const eofClosing = normalized.indexOf("\n---", 4);
    if (eofClosing >= 0 && eofClosing + 4 >= normalized.length) {
      const frontmatterRaw = normalized.slice(4, eofClosing).trim();
      return {
        frontmatter: parseYamlFrontmatter(frontmatterRaw),
        body: "",
      };
    }
    return { frontmatter: {}, body: normalized.trim() };
  }
  const frontmatterRaw = normalized.slice(4, closing).trim();
  const body = normalized.slice(closing + 5).trim();
  return {
    frontmatter: parseYamlFrontmatter(frontmatterRaw),
    body,
  };
}

/**
 * Classify a file path within a skill package into its inventory kind.
 * Uses directory prefixes and file extensions for classification.
 */
export function classifyInventoryKind(
  relativePath: string,
): FileInventoryEntry["kind"] {
  // Normalize path separators and lowercase for matching
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();

  if (normalized.endsWith("/skill.md") || normalized === "skill.md")
    return "skill";
  if (normalized.startsWith("references/")) return "reference";
  if (normalized.startsWith("scripts/")) return "script";
  if (normalized.startsWith("assets/")) return "asset";
  if (normalized.endsWith(".md")) return "markdown";

  const ext = extname(normalized).toLowerCase();
  const scriptExtensions = new Set([
    ".sh",
    ".js",
    ".mjs",
    ".cjs",
    ".ts",
    ".py",
    ".rb",
    ".bash",
  ]);
  if (scriptExtensions.has(ext)) return "script";

  const assetExtensions = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".webp",
    ".pdf",
  ]);
  if (assetExtensions.has(ext)) return "asset";

  return "other";
}

/**
 * Derive the trust level for a skill based on its file inventory.
 * Scripts/executables -> highest risk; assets -> medium; markdown only -> lowest.
 */
export function deriveTrustLevel(inventory: FileInventoryEntry[]): TrustLevel {
  if (inventory.some((entry) => entry.kind === "script"))
    return "scripts_executables";
  if (
    inventory.some(
      (entry) => entry.kind === "asset" || entry.kind === "other",
    )
  )
    return "assets";
  return "markdown_only";
}

/**
 * Estimate the token count for a text string.
 * Uses a rough 1:4 character-to-token ratio.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}
