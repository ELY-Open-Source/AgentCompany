import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { BASELINE_SKIP_DIR_NAMES } from "./artifact-baseline";
import { isGitRepo } from "./artifact-git";
import { logArtifactFsError } from "./artifact-logging";
import type { ArtifactProjectorRunContext, ChangeSet, GitChangeSet, WorkspaceBaseline } from "./artifact-types";

export function collectChangedPaths(ctx: ArtifactProjectorRunContext): ChangeSet {
  if (!ctx.workspacePath) {
    return { source: "none", changed: [], deleted: [], skipReason: "no_workspace" };
  }
  if (isGitRepo(ctx.workspacePath)) {
    try {
      const gitSet = listChangedRelPaths(ctx.workspacePath);
      return { source: "git", changed: gitSet.changed, deleted: gitSet.deleted };
    } catch (error) {
      logArtifactFsError(
        ctx.logger,
        error,
        "artifact.fs.git_status_failed",
        "Failed to read git status during artifact projection.",
        { workspacePath: ctx.workspacePath, runId: ctx.runId },
      );
      return { source: "none", changed: [], deleted: [], skipReason: "git_status_failed" };
    }
  }
  if (ctx.workspaceBaseline) {
    const diff = diffAgainstBaseline(ctx.workspacePath, ctx.workspaceBaseline, ctx.logger);
    return {
      source: "baseline",
      changed: diff.changed,
      deleted: diff.deleted,
      coverageTruncated: ctx.workspaceBaseline.truncated,
    };
  }
  return { source: "none", changed: [], deleted: [], skipReason: "no_baseline" };
}

function diffAgainstBaseline(
  workspacePath: string,
  baseline: WorkspaceBaseline,
  logger: ArtifactProjectorRunContext["logger"],
): GitChangeSet {
  const changed: string[] = [];
  const seenRels = new Set<string>();
  const stack: string[] = [workspacePath];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) break;
    let entries: { name: string; isDirectory: () => boolean; isSymbolicLink: () => boolean }[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      logArtifactFsError(
        logger,
        error,
        "artifact.fs.diff_readdir_failed",
        "Failed to read workspace directory during artifact diff.",
        { workspacePath, dir },
      );
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
      } catch (error) {
        logArtifactFsError(
          logger,
          error,
          "artifact.fs.diff_stat_failed",
          "Failed to stat workspace file during artifact diff.",
          { workspacePath, absPath: abs },
        );
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
  if (worktreeStatus === "D") return true;
  if (indexStatus === "D" && worktreeStatus === " ") return true;
  return false;
}
