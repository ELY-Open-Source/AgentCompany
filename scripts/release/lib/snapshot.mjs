import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";

export function createSnapshotHelpers(run, getGitHubHttpAuthHeader) {
  async function createSnapshotBranch({
    repo,
    branchName,
    rootDir,
    syncExcludes,
    commitMessage,
    afterRsync,
  }) {
    const tempDir = await mkdtemp(join(os.tmpdir(), "agentcompany-release-"));
    const auth = await getGitHubHttpAuthHeader();
    await run("git", [
      "-c",
      `http.https://github.com/.extraheader=AUTHORIZATION: basic ${auth}`,
      "fetch",
      `https://github.com/${repo.nameWithOwner}.git`,
      repo.defaultBranch,
    ]);
    await run("git", ["worktree", "add", "--detach", tempDir, "FETCH_HEAD"]);
    await run("git", ["-C", tempDir, "checkout", "-b", branchName]);

    const rsyncArgs = ["-a", "--delete"];
    for (const pattern of syncExcludes) {
      rsyncArgs.push("--exclude", pattern);
    }
    rsyncArgs.push(`${rootDir}/`, `${tempDir}/`);
    await run("rsync", rsyncArgs);

    await run("git", ["-C", tempDir, "add", "-A"]);
    if (afterRsync) {
      await afterRsync(tempDir);
    }
    const diffStatus = await run("git", ["-C", tempDir, "diff", "--cached", "--quiet"], { capture: true })
      .then(() => false)
      .catch(() => true);

    if (!diffStatus) {
      throw new Error("Snapshot branch has no staged changes after syncing the workspace.");
    }

    await run("git", ["-C", tempDir, "commit", "-m", commitMessage]);

    await run(
      "git",
      [
        "-C",
        tempDir,
        "-c",
        `http.https://github.com/.extraheader=AUTHORIZATION: basic ${auth}`,
        "push",
        `https://github.com/${repo.nameWithOwner}.git`,
        branchName,
      ],
    );

    return tempDir;
  }

  async function cleanupRemoteBranch(repo, branchName) {
    await run("gh", ["api", "-X", "DELETE", `repos/${repo.nameWithOwner}/git/refs/heads/${branchName}`]);
  }

  async function cleanupLocalWorktree(tempDir) {
    await run("git", ["worktree", "remove", "--force", tempDir]);
    await run("git", ["worktree", "prune"]);
  }

  return {
    createSnapshotBranch,
    cleanupRemoteBranch,
    cleanupLocalWorktree,
  };
}
