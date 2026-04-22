import { relative, resolve } from "node:path";
import { readdirSync, statSync } from "node:fs";
import { isGitRepo } from "./artifact-git";
import { logArtifactFsError, type Logger } from "./artifact-logging";
import type { WorkspaceBaseline } from "./artifact-types";

const MAX_BASELINE_ENTRIES = 20_000;

export const BASELINE_SKIP_DIR_NAMES: ReadonlySet<string> = new Set([
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
 * Capture a run-start mtime baseline only for non-git workspaces.
 * Git workspaces use `git status` as the authoritative diff source.
 */
export function captureBaselineIfRequired(
  workspacePath: string | null,
  logger?: Logger,
): WorkspaceBaseline | null {
  if (!workspacePath) return null;
  if (isGitRepo(workspacePath)) return null;
  try {
    if (!statSync(workspacePath).isDirectory()) return null;
  } catch (error) {
    logArtifactFsError(
      logger,
      error,
      "artifact.fs.workspace_stat_failed",
      "Failed to stat workspace before artifact baseline capture.",
      { workspacePath },
    );
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
    } catch (error) {
      logArtifactFsError(
        logger,
        error,
        "artifact.fs.baseline_readdir_failed",
        "Failed to read workspace directory during artifact baseline capture.",
        { workspacePath, dir },
      );
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
      } catch (error) {
        logArtifactFsError(
          logger,
          error,
          "artifact.fs.baseline_stat_failed",
          "Failed to stat workspace file during artifact baseline capture.",
          { workspacePath, absPath: abs },
        );
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
