import { isAbsolute, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import type { AppDatabase } from "@main/database";

/**
 * Filesystem artifact protocol for pi tool invocations.
 *
 * Every successful destructive tool call (`write`, `edit`, `bash`) is
 * projected into the `work_products` table so the desktop UI can
 * surface what the agent actually produced without requiring the agent
 * to remember to POST /api/documents.
 *
 * Projection is idempotent: the natural identity of an artifact is
 * `(companyId, workspaceId, provider="filesystem", externalId=<workspace-relative-path>)`.
 * The first tool call inserts; subsequent calls to the same path go
 * through `updateWorkProduct`, which also refreshes
 * `last_touched_by_run_id` so every run that modifies the file shows
 * up in the deliverable signal and in the DocumentCenter preview.
 *
 * `write` / `edit` expose the touched path in their args — the
 * projection path is trivial. `bash` is opaque: the tool may run any
 * command (git commit, npm build, shell redirection). Diffing uses two
 * sources of truth, chosen per workspace:
 *
 *  - git workspace → `git status --porcelain` reports modified and
 *    untracked files relative to HEAD;
 *  - non-git workspace → an mtime baseline captured at run start
 *    reports every file whose mtime advanced during the run.
 *
 * Either way the projector only upserts paths that survive the
 * registrability filter (`IGNORED_PATH_SEGMENTS` / extensions), so
 * build output and caches never pollute the DocumentCenter.
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
  /**
   * mtime snapshot captured at run start for workspaces that are NOT
   * a git repo. Diff-against-baseline is how `projectBashArtifacts`
   * and `reconcileWorkspaceArtifacts` find files the agent wrote
   * without a `.git` to fall back on.
   */
  workspaceBaseline: WorkspaceBaseline | null;
};

export interface WorkspaceBaseline {
  /** Relative path → mtimeMs at capture. */
  mtimeByRelPath: Map<string, number>;
  /** Unix ms at which the baseline was taken. */
  capturedAt: number;
  /** True when the walker stopped early because the cap was hit; the baseline is still usable for the paths that were captured. */
  truncated: boolean;
}

const MAX_BASELINE_ENTRIES = 20_000;
const BASELINE_SKIP_DIR_NAMES: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "out",
  ".cache",
  ".pnpm-store",
]);

/**
 * Walk `workspacePath` and record the mtime of every non-directory
 * entry. Directories matching `BASELINE_SKIP_DIR_NAMES` are pruned at
 * walk time — the same categories the registrability filter rejects —
 * so the baseline stays bounded on real project trees. Stops early at
 * `MAX_BASELINE_ENTRIES` and flags `truncated`; the partial baseline
 * still lets the diff detect every file it saw, while the operator is
 * told via the skip reason that an oversize workspace fell off the
 * tail.
 */
export function captureWorkspaceBaseline(workspacePath: string): WorkspaceBaseline | null {
  if (!workspacePath) return null;
  try {
    if (!statSync(workspacePath).isDirectory()) return null;
  } catch {
    return null;
  }
  const mtimeByRelPath = new Map<string, number>();
  const stack: string[] = [workspacePath];
  let truncated = false;
  while (stack.length > 0) {
    if (mtimeByRelPath.size >= MAX_BASELINE_ENTRIES) {
      truncated = true;
      break;
    }
    const dir = stack.pop();
    if (!dir) break;
    let entries: { name: string; isDirectory: () => boolean; isSymbolicLink: () => boolean }[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = resolve(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (BASELINE_SKIP_DIR_NAMES.has(entry.name)) continue;
        stack.push(abs);
        continue;
      }
      try {
        const stat = statSync(abs);
        if (!stat.isFile()) continue;
        const rel = relative(workspacePath, abs);
        if (rel.length === 0) continue;
        mtimeByRelPath.set(rel, stat.mtimeMs);
      } catch {
        continue;
      }
      if (mtimeByRelPath.size >= MAX_BASELINE_ENTRIES) {
        truncated = true;
        break;
      }
    }
  }
  return { mtimeByRelPath, capturedAt: Date.now(), truncated };
}

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
 * registers artifacts eagerly, but individual projections can still
 * skip (path on the ignore list, transient `git status` failure, or
 * an mtime baseline that was truncated). The sweep is the backstop:
 * every file the change-detector still knows about is upserted once
 * more before the run's resources are released, so the DocumentCenter
 * is never empty just because a single hook call lost a row.
 *
 * Diffing uses the same dual-source strategy as `projectBashArtifacts`:
 * `git status` when a `.git` is present, the captured mtime baseline
 * otherwise. Idempotent through `findWorkProductByExternalId`, which
 * keys on `(company, workspace, provider, externalId)`.
 */
export function reconcileWorkspaceArtifacts(
  db: AppDatabase,
  ctx: ArtifactProjectorRunContext,
): ProjectionOutcome[] {
  const change = collectChangedPaths(ctx);
  if (change.source === "none") {
    return [{ kind: "skipped", reason: change.skipReason ?? "no_changes" }];
  }
  if (change.paths.length === 0) return [{ kind: "skipped", reason: "no_changes" }];
  return projectChangedPaths(db, ctx, change.paths);
}

function projectChangedPaths(
  db: AppDatabase,
  ctx: ArtifactProjectorRunContext,
  changed: string[],
): ProjectionOutcome[] {
  const workspacePath = ctx.workspacePath;
  if (!workspacePath) return [{ kind: "skipped", reason: "no_workspace" }];
  const outcomes: ProjectionOutcome[] = [];
  const budget = changed.slice(0, MAX_BASH_PROJECTED_FILES);
  for (const rel of budget) {
    const absPath = resolve(workspacePath, rel);
    if (!isRegistrablePath(absPath, workspacePath)) {
      outcomes.push({ kind: "skipped", reason: "path_ignored" });
      continue;
    }
    outcomes.push(upsertFilesystemArtifact(db, ctx, workspacePath, absPath));
  }
  if (changed.length > MAX_BASH_PROJECTED_FILES) {
    outcomes.push({ kind: "skipped", reason: "bash_scan_cap_exceeded" });
  }
  return outcomes;
}

/**
 * Compare current workspace mtimes against the run-start baseline.
 * Returns every file whose mtime advanced (modified) or was not in
 * the baseline at all (created). Skipped-dir filtering mirrors the
 * baseline walker so the diff and the capture stay in sync.
 */
function diffAgainstBaseline(workspacePath: string, baseline: WorkspaceBaseline): string[] {
  const changed: string[] = [];
  const stack: string[] = [workspacePath];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) break;
    let entries: { name: string; isDirectory: () => boolean; isSymbolicLink: () => boolean }[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const abs = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (BASELINE_SKIP_DIR_NAMES.has(entry.name)) continue;
        stack.push(abs);
        continue;
      }
      let mtimeMs: number;
      try {
        const stat = statSync(abs);
        if (!stat.isFile()) continue;
        mtimeMs = stat.mtimeMs;
      } catch {
        continue;
      }
      const rel = relative(workspacePath, abs);
      if (rel.length === 0) continue;
      const previous = baseline.mtimeByRelPath.get(rel);
      if (previous === undefined || mtimeMs > previous) {
        changed.push(rel);
      }
    }
  }
  return changed;
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

type ChangeSource = "git" | "baseline" | "none";

interface ChangeSet {
  source: ChangeSource;
  /** Paths relative to the workspace root. */
  paths: string[];
  /** Reason the source chose to skip (only meaningful when source === "none"). */
  skipReason?: string;
}

function collectChangedPaths(ctx: ArtifactProjectorRunContext): ChangeSet {
  if (!ctx.workspacePath) return { source: "none", paths: [], skipReason: "no_workspace" };
  if (isGitRepo(ctx.workspacePath)) {
    try {
      return { source: "git", paths: listChangedRelPaths(ctx.workspacePath) };
    } catch {
      return { source: "none", paths: [], skipReason: "git_status_failed" };
    }
  }
  if (ctx.workspaceBaseline) {
    return { source: "baseline", paths: diffAgainstBaseline(ctx.workspacePath, ctx.workspaceBaseline) };
  }
  return { source: "none", paths: [], skipReason: "no_baseline" };
}

function projectBashArtifacts(
  db: AppDatabase,
  ctx: ArtifactProjectorRunContext,
): ProjectionOutcome[] {
  const change = collectChangedPaths(ctx);
  if (change.source === "none") {
    return [{ kind: "skipped", reason: change.skipReason ?? "no_changes" }];
  }
  if (change.paths.length === 0) return [{ kind: "skipped", reason: "no_changes" }];
  return projectChangedPaths(db, ctx, change.paths);
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
