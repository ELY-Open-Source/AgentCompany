import { existsSync } from "node:fs";
import { readFile, mkdir, cp, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "./release/lib/dotenv.mjs";
import { createRunner } from "./release/lib/process.mjs";
import { createWorkflowHelpers } from "./release/lib/workflow.mjs";
import { createSnapshotHelpers } from "./release/lib/snapshot.mjs";

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

const run = createRunner(rootDir);
const {
  getGitHubHttpAuthHeader,
  getRepoInfo,
  assertRemoteWorkflowExists,
  waitForWorkflowRun,
  waitForWorkflowCompletion,
  downloadRemoteAssets,
  cleanupRemoteTransportRelease,
} = createWorkflowHelpers(run);
const {
  createSnapshotBranch,
  cleanupRemoteBranch,
  cleanupLocalWorktree,
} = createSnapshotHelpers(run, getGitHubHttpAuthHeader);

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
  await assertRemoteWorkflowExists(
    repo,
    remoteBossWorkflowFile,
    `Remote workflow ${remoteBossWorkflowFile} was not found on ${repo.defaultBranch}. ` +
    "Commit and push this Boss automation workflow before using scripts/release-boss.mjs.",
  );
  await run("gh", ["auth", "status"], { capture: true });
}

function buildSnapshotCommitMessage(version) {
  return [
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await loadEnvFile(join(rootDir, ".env.release.local"));
  await loadEnvFile(join(rootDir, ".env.release"));

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

  const tempDir = await createSnapshotBranch({
    repo,
    branchName,
    rootDir,
    syncExcludes,
    commitMessage: buildSnapshotCommitMessage(nextVersion),
    afterRsync: forceStageBossSnapshotFiles,
  });
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
