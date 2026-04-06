import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, mkdir, cp, readdir } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const packageJsonPath = join(rootDir, "package.json");
const bossOutDir = join(rootDir, "boss-build", "build", "out");
const remoteBossWorkflowFile = ".github/workflows/remote-boss-platforms.yml";
const remoteBossWorkflowName = "remote-boss-platforms.yml";
const versionPattern = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;
const syncExcludes = [
  ".git",
  "node_modules/",
  ".pnpm-store/",
  "build/",
  "local-release/",
  "out/",
  ".omx/",
  ".omc/",
  ".claude/",
  "landing/.next/",
  "landing/out/",
  "landing/node_modules/",
  ".DS_Store",
  ".env.release.local",
  "CertificateSigningRequest.certSigningRequest",
  "Certificates.p12",
  "developerID_application.cer",
];
const bossSnapshotIncludes = [
  remoteBossWorkflowFile,
  "boss-build/boss-runtime.json",
  "boss-build/build-boss-desktop.mjs",
  "boss-build/build-boss-edition.mjs",
  "boss-build/build-boss-mac.mjs",
  "boss-build/build-boss.mjs",
  "boss-build/build-boss.sh",
  "boss-build/electron-builder-boss.yml",
];

function parseArgs(argv) {
  const options = {
    version: null,
    deleteRemoteBranch: false,
    keepTransportRelease: false,
  };

  for (const arg of argv) {
    if (arg.startsWith("--version=")) {
      options.version = arg.slice("--version=".length).trim();
      continue;
    }
    if (arg === "--delete-remote-branch") {
      options.deleteRemoteBranch = true;
      continue;
    }
    if (arg === "--keep-transport-release") {
      options.keepTransportRelease = true;
      continue;
    }
    if (arg === "--help") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/release-boss.mjs [options]

Options:
  --version=x.y.z          Explicit version. Defaults to current package version.
  --delete-remote-branch   Delete the GitHub snapshot branch after success.
  --keep-transport-release Keep the temporary draft GitHub release after success.
  --help                   Show this help.
`);
}

function run(command, args, options = {}) {
  const {
    cwd = rootDir,
    env = process.env,
    input = null,
    capture = false,
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: capture ? ["pipe", "pipe", "pipe"] : ["pipe", "inherit", "inherit"],
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr || stdout || `${command} ${args.join(" ")} failed with exit code ${code ?? 1}`));
    });
  });
}

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

async function assertRemoteBossWorkflowExists(repo) {
  try {
    await run("gh", [
      "api",
      `repos/${repo.nameWithOwner}/contents/${remoteBossWorkflowFile}?ref=${repo.defaultBranch}`,
    ], { capture: true });
  } catch {
    throw new Error(
      `Remote workflow ${remoteBossWorkflowFile} was not found on ${repo.defaultBranch}. ` +
      "Commit and push this Boss automation workflow before using scripts/release-boss.mjs.",
    );
  }
}

async function readPackageJson() {
  return JSON.parse(await readFile(packageJsonPath, "utf8"));
}

async function forceStageBossSnapshotFiles(tempDir) {
  const stagedPaths = bossSnapshotIncludes
    .filter((relativePath) => existsSync(join(tempDir, relativePath)));

  if (stagedPaths.length === 0) {
    throw new Error("Boss snapshot is missing required boss-build source files after syncing the workspace.");
  }

  await run("git", ["-C", tempDir, "add", "--force", ...stagedPaths]);
}

async function ensureRemoteBuildPrerequisites(repo) {
  if (process.platform !== "darwin") {
    throw new Error("Boss release currently expects to run on macOS for the local Boss DMG build.");
  }
  if (!existsSync(join(rootDir, remoteBossWorkflowFile))) {
    throw new Error(`Required workflow file missing locally: ${remoteBossWorkflowFile}`);
  }
  await assertRemoteBossWorkflowExists(repo);
  await run("gh", ["auth", "status"], { capture: true });
}

async function createSnapshotBranch(repo, branchName, version) {
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
  await forceStageBossSnapshotFiles(tempDir);
  const diffStatus = await run("git", ["-C", tempDir, "diff", "--cached", "--quiet"], { capture: true })
    .then(() => false)
    .catch(() => true);

  if (!diffStatus) {
    throw new Error("Snapshot branch has no staged changes after syncing the workspace.");
  }

  const commitMessage = [
    `Package Boss build ${version} from the current workspace snapshot`,
    "",
    "Constraint: Boss Windows artifacts are built on a native GitHub runner from a temporary snapshot branch",
    "Rejected: Build Boss Windows locally on Apple Silicon | docker/wine packaging is not stable on this host",
    "Confidence: medium",
    "Scope-risk: narrow",
    "Directive: This snapshot branch is transport-only and should be deleted after the Boss build is recovered locally",
    "Tested: local Boss mac build stages before snapshot creation",
    "Not-tested: remote Boss Windows packaging before workflow execution",
  ].join("\n");
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

async function dispatchRemoteBossWorkflow(repo, branchName, version, releaseTag, releaseTitle) {
  await run("gh", [
    "workflow",
    "run",
    remoteBossWorkflowName,
    "--repo",
    repo.nameWithOwner,
    "--ref",
    branchName,
    "-f",
    `version=${version}`,
    "-f",
    `release_tag=${releaseTag}`,
    "-f",
    `release_title=${releaseTitle}`,
  ]);
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

async function stageBossRemoteAssets(downloadRoot) {
  await mkdir(bossOutDir, { recursive: true });
  const files = await readdir(downloadRoot);
  for (const fileName of files) {
    if (fileName.endsWith(".exe") || fileName.endsWith(".blockmap")) {
      await cp(join(downloadRoot, fileName), join(bossOutDir, fileName));
    }
  }
}

async function buildBossMac(version) {
  await run("node", ["boss-build/build-boss-edition.mjs", `--platform=mac`, `--version=${version}`]);
}

async function cleanupRemoteTransportRelease(repo, releaseTag) {
  await run("gh", ["release", "delete", releaseTag, "--repo", repo.nameWithOwner, "--yes"]);
}

async function cleanupRemoteBranch(repo, branchName) {
  await run("gh", ["api", "-X", "DELETE", `repos/${repo.nameWithOwner}/git/refs/heads/${branchName}`]);
}

async function cleanupLocalWorktree(tempDir) {
  await run("git", ["worktree", "remove", "--force", tempDir]);
  await run("git", ["worktree", "prune"]);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repo = await getRepoInfo();
  await ensureRemoteBuildPrerequisites(repo);

  const currentVersion = (await readPackageJson()).version;
  const nextVersion = options.version ?? currentVersion;
  if (!versionPattern.test(nextVersion)) {
    throw new Error(`Invalid version: ${nextVersion}`);
  }

  const timestamp = Date.now();
  const releaseTag = `boss-transport-${nextVersion}-${timestamp}`;
  const branchName = `boss-build-${nextVersion.replace(/\./g, "-")}-${timestamp}`;
  const releaseTitle = `Boss Release ${nextVersion}`;

  const tempDir = await createSnapshotBranch(repo, branchName, nextVersion);
  let cleanupPending = true;

  try {
    await dispatchRemoteBossWorkflow(repo, branchName, nextVersion, releaseTag, releaseTitle);
    await buildBossMac(nextVersion);
    const runSummary = await waitForWorkflowRun(repo, remoteBossWorkflowName, branchName, 60_000);
    const runInfo = await waitForWorkflowCompletion(repo, runSummary.databaseId, 30 * 60 * 1000);
    if (runInfo.conclusion !== "success") {
      throw new Error(`Boss remote workflow failed: ${runInfo.url}`);
    }
    const downloadRoot = await downloadRemoteAssets(repo, releaseTag);
    await mkdir(bossOutDir, { recursive: true });
    await stageBossRemoteAssets(downloadRoot);

    if (!options.keepTransportRelease) {
      await cleanupRemoteTransportRelease(repo, releaseTag);
    }
    if (options.deleteRemoteBranch) {
      await cleanupRemoteBranch(repo, branchName);
    }
    await cleanupLocalWorktree(tempDir);
    cleanupPending = false;

    console.log(JSON.stringify({
      version: nextVersion,
      remoteBranch: branchName,
      remoteWorkflowRun: runInfo.url,
      bossOutDir,
      releaseTag,
    }, null, 2));
  } finally {
    if (cleanupPending) {
      try {
        await cleanupLocalWorktree(tempDir);
      } catch {
        // no-op during best-effort temp cleanup
      }
    }
  }
}

await main();
