import { isAbsolute, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import type { AppDatabase } from "@main/database";

/**
 * Filesystem artifact protocol for pi tool invocations.
 *
 * Every successful destructive tool call (`write`, `edit`, `bash`) is
 * projected into the `work_products` table so the desktop UI can
 * surface what the agent actually produced without requiring the
 * agent to remember to POST /api/documents.
 *
 * Projection is idempotent: the natural identity of an artifact is
 * `(companyId, provider="filesystem", externalId=<workspace-relative-path>)`.
 * The first tool call inserts; subsequent calls to the same path go
 * through `updateWorkProduct` so repeated edits do not spam duplicates.
 *
 * `write` / `edit` expose the touched path in their args — the
 * projection path is trivial. `bash` is opaque: the tool may run any
 * command, including commands that mutate the workspace
 * (git commit, npm build, file redirection). For bash we scan the
 * workspace for filesystem changes with `git status --porcelain`;
 * non-git workspaces fall through to an explicit skip since there
 * is no authoritative baseline to diff against.
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

/** Bash scan budget: cap file count + byte count per invocation so a
 *  runaway rebuild cannot flood the artifact table. */
const MAX_BASH_PROJECTED_FILES = 50;

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
  workspaceId: string | null;
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
 * Upsert work_products rows for a successful destructive tool call.
 * For `write` / `edit` the path comes directly from the tool args.
 * For `bash` we scan the workspace via `git status --porcelain`.
 *
 * Always returns an array — `write`/`edit` touch one path so the array
 * holds a single outcome; `bash` can surface many.
 */
export function projectToolExecutionToWorkProduct(
  db: AppDatabase,
  ctx: ArtifactProjectorRunContext,
  event: ArtifactProjectorToolEvent,
): ProjectionOutcome[] {
  if (event.isError) return [{ kind: "skipped", reason: "tool_error" }];
  if (!ctx.workspacePath) return [{ kind: "skipped", reason: "no_workspace" }];

  if (event.toolName === "write" || event.toolName === "edit") {
    return [projectSinglePathArtifact(db, ctx, event.toolName, event.args)];
  }
  if (event.toolName === "bash") {
    return projectBashArtifacts(db, ctx);
  }
  return [{ kind: "skipped", reason: "unsupported_tool" }];
}

/**
 * End-of-run reconciliation sweep. The per-tool `afterToolCall` hook
 * registers artifacts eagerly, but individual projections can skip
 * (bash against a non-git workspace, a path on the ignore list, a
 * transient `git status` failure). Without a final sweep, those files
 * land on disk but never in `work_products` — the DocumentCenter then
 * looks empty even though the agent produced deliverables.
 *
 * The sweep uses the same `git status` source of truth as
 * `projectBashArtifacts`; non-git workspaces are deliberately a no-op
 * because there is no authoritative diff against HEAD. It is
 * idempotent via `findWorkProductByExternalId`.
 */
export function reconcileWorkspaceArtifacts(
  db: AppDatabase,
  ctx: ArtifactProjectorRunContext,
): ProjectionOutcome[] {
  if (!ctx.workspacePath) return [{ kind: "skipped", reason: "no_workspace" }];
  if (!isGitRepo(ctx.workspacePath)) return [{ kind: "skipped", reason: "not_a_git_repo" }];

  let changed: string[];
  try {
    changed = listChangedRelPaths(ctx.workspacePath);
  } catch {
    return [{ kind: "skipped", reason: "git_status_failed" }];
  }
  if (changed.length === 0) return [{ kind: "skipped", reason: "no_changes" }];

  const outcomes: ProjectionOutcome[] = [];
  const budget = changed.slice(0, MAX_BASH_PROJECTED_FILES);
  for (const rel of budget) {
    const absPath = resolve(ctx.workspacePath, rel);
    if (!isRegistrablePath(absPath, ctx.workspacePath)) {
      outcomes.push({ kind: "skipped", reason: "path_ignored" });
      continue;
    }
    outcomes.push(upsertFilesystemArtifact(db, ctx, ctx.workspacePath, absPath));
  }
  if (changed.length > MAX_BASH_PROJECTED_FILES) {
    outcomes.push({ kind: "skipped", reason: "bash_scan_cap_exceeded" });
  }
  return outcomes;
}

function projectSinglePathArtifact(
  db: AppDatabase,
  ctx: ArtifactProjectorRunContext,
  toolName: string,
  args: unknown,
): ProjectionOutcome {
  if (!ctx.workspacePath) return { kind: "skipped", reason: "no_workspace" };
  const rawPath = extractToolPath(toolName, args);
  if (!rawPath) return { kind: "skipped", reason: "missing_path" };

  const absPath = isAbsolute(rawPath) ? rawPath : resolve(ctx.workspacePath, rawPath);
  if (!isRegistrablePath(absPath, ctx.workspacePath)) {
    return { kind: "skipped", reason: "path_ignored" };
  }
  return upsertFilesystemArtifact(db, ctx, ctx.workspacePath, absPath);
}

function projectBashArtifacts(
  db: AppDatabase,
  ctx: ArtifactProjectorRunContext,
): ProjectionOutcome[] {
  if (!ctx.workspacePath) return [{ kind: "skipped", reason: "no_workspace" }];
  if (!isGitRepo(ctx.workspacePath)) {
    return [{ kind: "skipped", reason: "not_a_git_repo" }];
  }
  let changed: string[];
  try {
    changed = listChangedRelPaths(ctx.workspacePath);
  } catch {
    return [{ kind: "skipped", reason: "git_status_failed" }];
  }
  if (changed.length === 0) return [{ kind: "skipped", reason: "no_changes" }];

  const outcomes: ProjectionOutcome[] = [];
  const budget = changed.slice(0, MAX_BASH_PROJECTED_FILES);
  for (const rel of budget) {
    const absPath = resolve(ctx.workspacePath, rel);
    if (!isRegistrablePath(absPath, ctx.workspacePath)) {
      outcomes.push({ kind: "skipped", reason: "path_ignored" });
      continue;
    }
    outcomes.push(upsertFilesystemArtifact(db, ctx, ctx.workspacePath, absPath));
  }
  if (changed.length > MAX_BASH_PROJECTED_FILES) {
    outcomes.push({ kind: "skipped", reason: "bash_scan_cap_exceeded" });
  }
  return outcomes;
}

function isGitRepo(workspacePath: string): boolean {
  try {
    return existsSync(resolve(workspacePath, ".git")) && statSync(resolve(workspacePath, ".git")).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Enumerate tracked-modified + untracked files via `git status --porcelain=v1 -z`.
 *
 * Output format per entry: `XY path`. NUL terminates each entry. For
 * renames the new path is in the entry with the `R` status code and
 * the old path follows as its own NUL-terminated entry — we advance
 * past that old-path entry without emitting it.
 */
function listChangedRelPaths(workspacePath: string): string[] {
  const raw = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd: workspacePath,
    timeout: 5_000,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (!raw) return [];
  const entries = raw.split("\0").filter(Boolean);
  const paths: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.length < 3) continue;
    const statusCode = entry.slice(0, 2);
    const rest = entry.slice(3);
    if (statusCode === "!!") continue;
    paths.push(rest);
    const isRename = statusCode[0] === "R" || statusCode[1] === "R";
    if (isRename) i += 1;
  }
  return paths;
}

function upsertFilesystemArtifact(
  db: AppDatabase,
  ctx: ArtifactProjectorRunContext,
  workspacePath: string,
  absPath: string,
): ProjectionOutcome {
  const relativePath = relative(workspacePath, absPath);
  const lastSlash = relativePath.lastIndexOf("/");
  const title = lastSlash >= 0 ? relativePath.slice(lastSlash + 1) : relativePath;

  const provider = "filesystem";
  // Identity is scoped to (company, workspace, provider, externalId) so two
  // workspaces with the same relative path do not collapse onto one row.
  // Every touch refreshes `last_touched_by_run_id` so the deliverable
  // signal, the DocumentCenter preview, and the run-provenance readers
  // all see the latest run that wrote the file.
  const existing = db.findWorkProductByExternalId(ctx.companyId, provider, relativePath, ctx.workspaceId);
  if (existing) {
    db.updateWorkProduct(existing.id, ctx.companyId, {
      title,
      lastTouchedByRunId: ctx.runId,
      workspaceId: ctx.workspaceId,
    });
    return { kind: "updated", workProductId: existing.id, relativePath };
  }
  const workProductId = db.createWorkProduct({
    companyId: ctx.companyId,
    taskId: ctx.taskId,
    workspaceId: ctx.workspaceId,
    type: "file",
    provider,
    externalId: relativePath,
    title,
    url: null,
    createdByRunId: ctx.runId,
  });
  return { kind: "inserted", workProductId, relativePath };
}
