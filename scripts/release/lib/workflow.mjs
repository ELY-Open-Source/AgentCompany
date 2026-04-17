import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";

export function createWorkflowHelpers(run) {
  async function ghJson(args) {
    const { stdout } = await run("gh", args, { capture: true });
    return JSON.parse(stdout);
  }

  async function getGitHubHttpAuthHeader() {
    const tokenResult = await run("gh", ["auth", "token"], { capture: true });
    const token = tokenResult.stdout.trim();
    if (!token) {
      throw new Error("Unable to read a GitHub token from gh auth.");
    }
    return Buffer.from(`x-access-token:${token}`).toString("base64");
  }

  async function getRepoInfo() {
    const info = await ghJson(["repo", "view", "--json", "nameWithOwner,defaultBranchRef"]);
    const defaultBranch = info.defaultBranchRef?.name;
    if (!info.nameWithOwner || !defaultBranch) {
      throw new Error("Unable to resolve GitHub repository name/default branch from gh.");
    }
    return {
      nameWithOwner: info.nameWithOwner,
      defaultBranch,
    };
  }

  async function assertRemoteWorkflowExists(repo, workflowFile, errorMessage) {
    try {
      await run("gh", [
        "api",
        `repos/${repo.nameWithOwner}/contents/${workflowFile}?ref=${repo.defaultBranch}`,
      ], { capture: true });
    } catch {
      throw new Error(errorMessage);
    }
  }

  async function waitForWorkflowRun(repo, workflowName, branchName, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const runs = await ghJson([
        "run",
        "list",
        "--repo",
        repo.nameWithOwner,
        "--workflow",
        workflowName,
        "--branch",
        branchName,
        "--limit",
        "1",
        "--json",
        "databaseId,status,conclusion,url,displayTitle",
      ]);
      if (runs.length > 0) {
        return runs[0];
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    throw new Error(`Timed out waiting for workflow ${workflowName} on branch ${branchName}.`);
  }

  async function waitForWorkflowCompletion(repo, runId, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const runInfo = await ghJson([
        "run",
        "view",
        String(runId),
        "--repo",
        repo.nameWithOwner,
        "--json",
        "status,conclusion,url",
      ]);
      if (runInfo.status === "completed") {
        return runInfo;
      }
      await new Promise((resolve) => setTimeout(resolve, 15000));
    }
    throw new Error(`Timed out waiting for workflow run ${runId} to complete.`);
  }

  async function downloadRemoteAssets(repo, releaseTag) {
    const downloadRoot = await mkdtemp(join(os.tmpdir(), "agentcompany-transport-"));
    await run("gh", [
      "release",
      "download",
      releaseTag,
      "--repo",
      repo.nameWithOwner,
      "-D",
      downloadRoot,
    ]);
    return downloadRoot;
  }

  async function cleanupRemoteTransportRelease(repo, releaseTag) {
    await run("gh", ["release", "delete", releaseTag, "--repo", repo.nameWithOwner, "--yes"]);
  }

  return {
    ghJson,
    getGitHubHttpAuthHeader,
    getRepoInfo,
    assertRemoteWorkflowExists,
    waitForWorkflowRun,
    waitForWorkflowCompletion,
    downloadRemoteAssets,
    cleanupRemoteTransportRelease,
  };
}
