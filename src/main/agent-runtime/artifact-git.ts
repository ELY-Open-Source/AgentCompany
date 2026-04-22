import { spawnSync } from "node:child_process";

/**
 * Ask git whether `workspacePath` sits inside a working tree. This
 * covers a plain clone, linked worktree, and submodule.
 */
export function isGitRepo(workspacePath: string): boolean {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: workspacePath,
    timeout: 2_000,
    stdio: ["ignore", "ignore", "ignore"],
  });
  return result.status === 0;
}
