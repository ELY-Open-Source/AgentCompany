import { isAbsolute, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
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
 * Capture a run-start mtime baseline only for workspaces that need
 * one. Git workspaces return null here because `git status` already
 * provides the authoritative diff — paying for an O(tree) walk on
 * every run just to throw the result away is a hot-path tax the
 * scheduler should not be paying.
 *
 * For non-git workspaces, walk the workspace and record the mtime of
 * every non-directory entry. Directories matching
 * `BASELINE_SKIP_DIR_NAMES` are pruned at walk time — the same
 * categories the registrability filter rejects — so the baseline
 * stays bounded on real project trees. The walker stops early at
 * `MAX_BASELINE_ENTRIES` and flags `truncated`; the partial baseline
 * still covers every path that was captured while the operator sees
 * the cap signal.
 */
export function captureBaselineIfRequired(workspacePath: string | null): WorkspaceBaseline | null {
  if (!workspacePath) return null;
  if (isGitRepo(workspacePath)) return null;
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
  | { kind: "updated"; workProductId: string; relativePath: string }
  | { kind: "retired"; workProductId: string; relativePath: string };

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
  const outcomes: ProjectionOutcome[] = [];
  if (change.changed.length === 0 && change.deleted.length === 0) {
    outcomes.push({ kind: "skipped", reason: "no_changes" });
  } else {
    outcomes.push(...projectChangedPaths(db, ctx, change.changed));
    outcomes.push(...retireDeletedArtifacts(db, ctx, change.deleted));
  }
  if (change.coverageTruncated) {
    outcomes.push({ kind: "skipped", reason: "baseline_truncated" });
  }
  return outcomes;
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
 * Archive `work_products` rows whose filesystem sources the change
 * detector reported as removed during this run. The row stays in the
 * table as a tombstone (operators can audit who produced what) but
 * drops to `status = "archived"` so the DocumentCenter stops
 * surfacing it and `openWorkProduct` no longer leads to an empty
 * path. `last_touched_by_run_id` carries the retiring run so the
 * provenance timeline records the deletion alongside the earlier
 * edits.
 */
function retireDeletedArtifacts(
  db: AppDatabase,
  ctx: ArtifactProjectorRunContext,
  deleted: string[],
): ProjectionOutcome[] {
  if (deleted.length === 0) return [];
  const outcomes: ProjectionOutcome[] = [];
  const budget = deleted.slice(0, MAX_BASH_PROJECTED_FILES);
  for (const rel of budget) {
    const existing = db.findWorkProductByExternalId(
      ctx.companyId,
      "filesystem",
      rel,
      ctx.workspaceId,
    );
    if (!existing) continue;
    db.updateWorkProduct(existing.id, ctx.companyId, {
      status: "archived",
      lastTouchedByRunId: ctx.runId,
      workspaceId: ctx.workspaceId,
    });
    outcomes.push({ kind: "retired", workProductId: existing.id, relativePath: rel });
  }
  return outcomes;
}

/**
 * Compare current workspace mtimes against the run-start baseline.
 * Skipped-dir filtering mirrors the baseline walker so the diff and
 * the capture stay in sync.
 *
 * A file is reported as `changed` when either:
 *
 *   - its mtime advanced past the captured value, or
 *   - it was not in the baseline AND the baseline saw the whole tree
 *     (`baseline.truncated === false`).
 *
 * A file is reported as `deleted` when it was in the baseline at
 * capture time and is no longer a regular file on disk — the
 * retirement path archives the matching `work_products` row so the
 * DocumentCenter stops showing a removed file.
 *
 * A truncated baseline deliberately stops classifying unsampled files
 * as new: the walker gave up before reaching them, so we cannot
 * distinguish a file that was always there from a file the run just
 * wrote. Falsely registering every one of them as a deliverable is
 * worse than missing a few that live past the sample cap. Callers
 * emit a `baseline_truncated` outcome so operators see the degraded
 * signal.
 */
function diffAgainstBaseline(workspacePath: string, baseline: WorkspaceBaseline): GitChangeSet {
  const changed: string[] = [];
  const seenRels = new Set<string>();
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
      seenRels.add(rel);
      const previous = baseline.mtimeByRelPath.get(rel);
      if (previous === undefined) {
        if (!baseline.truncated) changed.push(rel);
        continue;
      }
      if (mtimeMs > previous) changed.push(rel);
    }
  }
  const deleted: string[] = [];
  for (const rel of baseline.mtimeByRelPath.keys()) {
    if (!seenRels.has(rel)) deleted.push(rel);
  }
  return { changed, deleted };
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
  /** Paths, relative to the workspace root, that currently exist on disk with a new or advanced mtime. */
  changed: string[];
  /** Paths, relative to the workspace root, that the detector reports as removed during the run. */
  deleted: string[];
  /** Reason the source chose to skip (only meaningful when source === "none"). */
  skipReason?: string;
  /**
   * True when the baseline walker stopped before sampling the whole
   * tree. Callers surface it as a `baseline_truncated` skip outcome so
   * the operator can see that unsampled files are deliberately outside
   * the diff — registering them would falsely claim hundreds of
   * unchanged files as new deliverables.
   */
  coverageTruncated?: boolean;
}

function collectChangedPaths(ctx: ArtifactProjectorRunContext): ChangeSet {
  if (!ctx.workspacePath) {
    return { source: "none", changed: [], deleted: [], skipReason: "no_workspace" };
  }
  if (isGitRepo(ctx.workspacePath)) {
    try {
      const gitSet = listChangedRelPaths(ctx.workspacePath);
      return { source: "git", changed: gitSet.changed, deleted: gitSet.deleted };
    } catch {
      return { source: "none", changed: [], deleted: [], skipReason: "git_status_failed" };
    }
  }
  if (ctx.workspaceBaseline) {
    const diff = diffAgainstBaseline(ctx.workspacePath, ctx.workspaceBaseline);
    return {
      source: "baseline",
      changed: diff.changed,
      deleted: diff.deleted,
      coverageTruncated: ctx.workspaceBaseline.truncated,
    };
  }
  return { source: "none", changed: [], deleted: [], skipReason: "no_baseline" };
}

function projectBashArtifacts(
  db: AppDatabase,
  ctx: ArtifactProjectorRunContext,
): ProjectionOutcome[] {
  const change = collectChangedPaths(ctx);
  if (change.source === "none") {
    return [{ kind: "skipped", reason: change.skipReason ?? "no_changes" }];
  }
  const outcomes: ProjectionOutcome[] = [];
  if (change.changed.length === 0 && change.deleted.length === 0) {
    outcomes.push({ kind: "skipped", reason: "no_changes" });
  } else {
    outcomes.push(...projectChangedPaths(db, ctx, change.changed));
    outcomes.push(...retireDeletedArtifacts(db, ctx, change.deleted));
  }
  if (change.coverageTruncated) {
    outcomes.push({ kind: "skipped", reason: "baseline_truncated" });
  }
  return outcomes;
}

/**
 * Ask git whether `workspacePath` sits inside a working tree. This
 * covers the three forms the `.git` entry takes in real setups:
 *
 *   - a directory (a plain clone),
 *   - a file with `gitdir: …` (a linked worktree), or
 *   - a file with `gitdir: …/modules/…` (a submodule).
 *
 * The previous `existsSync + isDirectory` probe only recognised the
 * first form, so linked worktrees and submodules silently degraded
 * onto the baseline path — and lost `git status` as the authoritative
 * diff source. `rev-parse --is-inside-work-tree` exits 0 whenever git
 * itself would accept the directory, which is the semantics we want.
 */
function isGitRepo(workspacePath: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: workspacePath,
      timeout: 2_000,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

interface GitChangeSet {
  changed: string[];
  deleted: string[];
}

/**
 * Enumerate porcelain status entries and split them into "currently on
 * disk" (`changed`) and "removed during the run" (`deleted`). The
 * retirement path consumes `deleted` to archive the matching
 * `work_products` row so the DocumentCenter stops showing a file that
 * no longer exists.
 *
 * Porcelain v1 format per entry: `XY path`, NUL-terminated. For
 * renames the new path is the entry and the old path follows as its
 * own NUL-terminated trailer — we advance past the trailer without
 * emitting it.
 */
function listChangedRelPaths(workspacePath: string): GitChangeSet {
  const raw = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd: workspacePath,
    timeout: 5_000,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (!raw) return { changed: [], deleted: [] };
  const entries = raw.split("\0").filter(Boolean);
  const changed: string[] = [];
  const deleted: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.length < 3) continue;
    const indexStatus = entry[0];
    const worktreeStatus = entry[1];
    const rest = entry.slice(3);
    if (indexStatus === "!" && worktreeStatus === "!") continue;
    const isRename = indexStatus === "R" || worktreeStatus === "R";
    if (representsDeletion(indexStatus, worktreeStatus)) {
      deleted.push(rest);
      if (isRename) i += 1;
      continue;
    }
    changed.push(rest);
    if (isRename) i += 1;
  }
  return { changed, deleted };
}

function representsDeletion(indexStatus: string, worktreeStatus: string): boolean {
  // Worktree missing (`Y = D`) always means the file is not on disk.
  if (worktreeStatus === "D") return true;
  // Staged deletion whose worktree matches (`XD` + Y space) means the
  // file was removed from the tree and the worktree is in sync; the
  // retirement path needs to hear about it so the corresponding
  // `work_products` row can be archived.
  if (indexStatus === "D" && worktreeStatus === " ") return true;
  return false;
}

function upsertFilesystemArtifact(
  db: AppDatabase,
  ctx: ArtifactProjectorRunContext,
  workspacePath: string,
  absPath: string,
): ProjectionOutcome {
  const relativePath = relative(workspacePath, absPath);

  // Defense-in-depth against the change-detectors (git status + the
  // baseline diff) reporting a path whose file is no longer a regular
  // file on disk: a staged deletion that was undone mid-run, a symlink
  // that replaced a file, a path that the agent touched and then
  // rm'd. Registering it would plant a ghost row in `work_products`
  // whose DocumentCenter "open" link leads nowhere.
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(absPath);
  } catch {
    return { kind: "skipped", reason: "path_missing" };
  }
  if (!stat.isFile()) {
    return { kind: "skipped", reason: "not_a_regular_file" };
  }

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
    // `status: "active"` flips a previously-archived row (earlier run
    // retired the path, this run recreated it) back into the visible
    // DocumentCenter set. `lastTouchedByRunId` keeps the provenance
    // timeline pointed at the run that just wrote the bytes.
    db.updateWorkProduct(existing.id, ctx.companyId, {
      title,
      status: "active",
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
