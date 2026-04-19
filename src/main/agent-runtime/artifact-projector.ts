import { isAbsolute, relative, resolve } from "node:path";
import type { AppDatabase } from "@main/database";

/**
 * Auto-registration of filesystem artifacts produced by pi's write / edit
 * tools. Every successful tool call that mutates a workspace file is
 * projected into a `work_products` row so the desktop UI sees what the
 * agent actually produced — the old behavior required the agent to call
 * `POST /api/documents` manually, which was routinely forgotten and left
 * dozens of files on disk invisible to users.
 *
 * Registration is idempotent: the natural identity of an artifact is
 * `(companyId, provider, externalId)` where externalId is the workspace-
 * relative path. Re-writing a file updates the existing row instead of
 * creating duplicates.
 *
 * This module is pure data-structure plumbing — it holds no state and
 * does no I/O beyond the single SQLite upsert. The RuntimeBridge owns
 * the call site.
 */

/** Paths we never register — tool output that is never a deliverable. */
const IGNORED_PATH_SEGMENTS: readonly string[] = [
  "/.git/",
  "/node_modules/",
  "/.next/",
  "/dist/",
  "/build/",
  "/out/",
  "/.cache/",
  "/.pnpm-store/",
  "/.DS_Store",
];
const IGNORED_EXACT_NAMES: ReadonlySet<string> = new Set([
  ".DS_Store",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  ".gitignore",
]);
/** Extensions we never register as work products (binaries, build output). */
const IGNORED_EXTENSIONS: ReadonlySet<string> = new Set([
  ".lock",
  ".log",
  ".map",
  ".min.js",
  ".min.css",
]);

export type ArtifactProjectorToolEvent = {
  toolName: string;
  args: unknown;
  result: unknown;
  isError: boolean;
};

export type ArtifactProjectorRunContext = {
  runId: string;
  agentId: string;
  companyId: string;
  taskId: string | null;
  workspacePath: string | null;
};

type WriteArgs = { path: unknown; content?: unknown };
type EditArgs = { path: unknown };

/** Normalises pi tool-call args to the file path the agent touched. */
function extractToolPath(toolName: string, args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  if (toolName === "write") {
    const p = (args as WriteArgs).path;
    return typeof p === "string" && p.length > 0 ? p : null;
  }
  if (toolName === "edit") {
    const p = (args as EditArgs).path;
    return typeof p === "string" && p.length > 0 ? p : null;
  }
  return null;
}

/** Returns true when the path is inside the workspace and not on the ignore list. */
function isRegistrablePath(absPath: string, workspacePath: string): boolean {
  const rel = relative(workspacePath, absPath);
  if (rel.startsWith("..") || isAbsolute(rel)) return false;
  const probePath = `/${rel}/`;
  if (IGNORED_PATH_SEGMENTS.some((seg) => probePath.includes(seg))) return false;
  const lastSlash = rel.lastIndexOf("/");
  const basename = lastSlash >= 0 ? rel.slice(lastSlash + 1) : rel;
  if (IGNORED_EXACT_NAMES.has(basename)) return false;
  const dot = basename.lastIndexOf(".");
  if (dot > 0) {
    const ext = basename.slice(dot).toLowerCase();
    if (IGNORED_EXTENSIONS.has(ext)) return false;
    // Catch compound extensions like ".min.js" by checking the last two dots.
    const prevDot = basename.lastIndexOf(".", dot - 1);
    if (prevDot > 0) {
      const compound = basename.slice(prevDot).toLowerCase();
      if (IGNORED_EXTENSIONS.has(compound)) return false;
    }
  }
  return true;
}

export type ProjectionOutcome =
  | { kind: "skipped"; reason: string }
  | { kind: "inserted"; workProductId: string; relativePath: string }
  | { kind: "updated"; workProductId: string; relativePath: string };

/**
 * Upsert a work_products row for a successful write/edit tool call.
 * Returns an outcome describing whether the artifact was inserted,
 * updated, or skipped (with reason). Returns "skipped" for every
 * non-applicable case so the caller can log a single stream of events.
 */
export function projectToolExecutionToWorkProduct(
  db: AppDatabase,
  ctx: ArtifactProjectorRunContext,
  event: ArtifactProjectorToolEvent,
): ProjectionOutcome {
  if (event.isError) return { kind: "skipped", reason: "tool_error" };
  if (event.toolName !== "write" && event.toolName !== "edit") {
    return { kind: "skipped", reason: "unsupported_tool" };
  }
  if (!ctx.workspacePath) return { kind: "skipped", reason: "no_workspace" };

  const rawPath = extractToolPath(event.toolName, event.args);
  if (!rawPath) return { kind: "skipped", reason: "missing_path" };

  const absPath = isAbsolute(rawPath) ? rawPath : resolve(ctx.workspacePath, rawPath);
  if (!isRegistrablePath(absPath, ctx.workspacePath)) {
    return { kind: "skipped", reason: "path_ignored" };
  }

  const relativePath = relative(ctx.workspacePath, absPath);
  const lastSlash = relativePath.lastIndexOf("/");
  const title = lastSlash >= 0 ? relativePath.slice(lastSlash + 1) : relativePath;

  const provider = "filesystem";
  const existing = db.findWorkProductByExternalId(ctx.companyId, provider, relativePath);
  if (existing) {
    db.updateWorkProduct(existing.id, ctx.companyId, { title });
    return { kind: "updated", workProductId: existing.id, relativePath };
  }

  const workProductId = db.createWorkProduct({
    companyId: ctx.companyId,
    taskId: ctx.taskId,
    type: "file",
    provider,
    externalId: relativePath,
    title,
    url: null,
    createdByRunId: ctx.runId,
  });
  return { kind: "inserted", workProductId, relativePath };
}
