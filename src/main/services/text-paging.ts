import { optionalText } from "./agent-tool-args";
import type { JsonRecord } from "./provider-http";

const PAGE_CHAR_LIMIT = 24_000;
const SEARCH_MATCH_LIMIT = 200;

export interface PageRequest {
  startLine: number;
  startColumn: number;
  lineCount: number | null;
  search: string | null;
}

export const PAGE_TOOL_PROPERTIES = {
  start_line: { type: "number", description: "First line to read (1-based). Use the start_line a truncated read tells you to continue." },
  line_count: { type: "number", description: "How many lines to read from start_line." },
  start_column: { type: "number", description: "Character in start_line to begin at (1-based), for continuing a cut line." },
  search: { type: "string", description: "Return only the lines containing this text (case-insensitive), with line numbers." },
} as const;

export function readPageArgs(args: JsonRecord): PageRequest {
  const search = optionalText(args.search, "search");
  return {
    startLine: positiveInteger(args.start_line, "start_line") ?? 1,
    startColumn: positiveInteger(args.start_column, "start_column") ?? 1,
    lineCount: positiveInteger(args.line_count, "line_count"),
    search,
  };
}

/** A window of the text that fits one tool result, with directions to the rest. */
export function pageText(name: string, content: string, request: PageRequest): string {
  const lines = content.split("\n");
  if (request.search) return searchLines(name, lines, request.search);
  if (request.startLine > lines.length) throw new Error(`${name} has only ${lines.length} lines.`);
  const last = request.lineCount === null ? lines.length : Math.min(lines.length, request.startLine + request.lineCount - 1);
  const picked: string[] = [];
  let size = 0;
  let cut = false;
  let lineNumber = request.startLine;
  for (; lineNumber <= last; lineNumber += 1) {
    const offset = lineNumber === request.startLine ? request.startColumn - 1 : 0;
    const line = lines[lineNumber - 1].slice(offset);
    const separator = picked.length > 0 ? 1 : 0;
    if (size + separator + line.length > PAGE_CHAR_LIMIT) {
      if (picked.length === 0) {
        const nextColumn = offset + PAGE_CHAR_LIMIT + 1;
        picked.push(`${line.slice(0, PAGE_CHAR_LIMIT)}\n[line ${lineNumber} continues: pass start_line=${lineNumber} and start_column=${nextColumn}]`);
        cut = true;
        lineNumber += 1;
      }
      break;
    }
    picked.push(line);
    size += separator + line.length;
  }
  const end = lineNumber - 1;
  if (request.startLine === 1 && request.startColumn === 1 && end === lines.length && !cut) return content;
  const more = end < lines.length ? `\n[more: pass start_line=${end + 1} to continue]` : "";
  return `[lines ${request.startLine}-${end} of ${lines.length} in ${name}]\n${picked.join("\n")}${more}`;
}

function searchLines(name: string, lines: string[], search: string): string {
  const needle = search.toLowerCase();
  const matches: string[] = [];
  let total = 0;
  let size = 0;
  lines.forEach((line, index) => {
    if (!line.toLowerCase().includes(needle)) return;
    total += 1;
    const entry = `${index + 1}: ${line.slice(0, 500)}`;
    if (matches.length >= SEARCH_MATCH_LIMIT || size + entry.length + 1 > PAGE_CHAR_LIMIT) return;
    matches.push(entry);
    size += entry.length + 1;
  });
  if (total === 0) return `No lines in ${name} contain "${search}".`;
  const cut = total > matches.length ? `\n[${total - matches.length} more matches not shown; narrow the search]` : "";
  return `[${total} matching lines for "${search}" in ${name}]\n${matches.join("\n")}${cut}`;
}

function positiveInteger(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new Error(`"${field}" must be a positive whole number.`);
  return value;
}
