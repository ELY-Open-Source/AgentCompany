import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile, mkdir, cp, readdir } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareR2ReleaseHost, uploadReleaseFiles } from "./release-local/r2.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const packageJsonPath = join(rootDir, "package.json");
const landingDir = join(rootDir, "landing");
const localReleaseDir = join(rootDir, "local-release");
const remoteWorkflowFile = ".github/workflows/remote-release-platforms.yml";
const remoteWorkflowName = "remote-release-platforms.yml";
const pagesProjectName = "agentcompany";
const pagesBranch = "main";
const versionPattern = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;
const syncExcludes = [
  ".git",
  ".github/workflows/",
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

function parseArgs(argv) {
  const options = {
    version: null,
    skipVerify: false,
    deleteRemoteBranch: false,
    keepTransportRelease: false,
  };

  for (const arg of argv) {
    if (arg.startsWith("--version=")) {
      options.version = arg.slice("--version=".length).trim();
      continue;
    }
    if (arg === "--skip-verify") {
      options.skipVerify = true;
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
  console.log(`Usage: node scripts/release-cloudflare.mjs [options]

Options:
  --version=x.y.z          Explicit version. Defaults to current patch + 1.
  --skip-verify            Skip local pnpm verify before packaging.
  --delete-remote-branch   Delete the GitHub snapshot branch after success.
  --keep-transport-release Keep the temporary draft GitHub release after success.
  --help                   Show this help.
`);
}

async function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const content = await readFile(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    if (!key || process.env[key]) continue;
    const rawValue = line.slice(separatorIndex + 1).trim();
    if (!rawValue) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
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

async function assertRemoteWorkflowExists(repo) {
  try {
    await run("gh", [
      "api",
      `repos/${repo.nameWithOwner}/contents/${remoteWorkflowFile}?ref=${repo.defaultBranch}`,
    ], { capture: true });
  } catch {
    throw new Error(
      `Remote workflow ${remoteWorkflowFile} was not found on ${repo.defaultBranch}. ` +
      "Commit and push this automation workflow before using scripts/release-cloudflare.mjs.",
    );
  }
}

async function readPackageJson() {
  return JSON.parse(await readFile(packageJsonPath, "utf8"));
}

function bumpPatchVersion(version) {
  const match = versionPattern.exec(version);
  if (!match) {
    throw new Error(`Unsupported package version format: ${version}`);
  }
  const [, major, minor, patch] = match;
  return `${major}.${minor}.${Number.parseInt(patch, 10) + 1}`;
}

async function updatePackageVersion(nextVersion) {
  const pkg = await readPackageJson();
  pkg.version = nextVersion;
  await writeFile(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

async function ensureRemoteBuildPrerequisites(repo) {
  if (process.platform !== "darwin") {
    throw new Error("This release script currently expects to run on macOS for the signed macOS build.");
  }
  if (!existsSync(join(rootDir, remoteWorkflowFile))) {
    throw new Error(`Required workflow file missing locally: ${remoteWorkflowFile}`);
  }
  await assertRemoteWorkflowExists(repo);
  await run("gh", ["auth", "status"], { capture: true });
  await run("npx", ["wrangler", "whoami", "--json"], { capture: true });
}

async function resetReleaseStaging() {
  await rm(localReleaseDir, { recursive: true, force: true });
  await rm(join(rootDir, "build", "release"), { recursive: true, force: true });
}

async function buildMacAndUpload() {
  await run("node", ["scripts/release-local.mjs", "--platforms=mac", "--skip-verify"]);
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
  const diffStatus = await run("git", ["-C", tempDir, "diff", "--cached", "--quiet"], { capture: true })
    .then(() => false)
    .catch(() => true);

  if (!diffStatus) {
    throw new Error("Snapshot branch has no staged changes after syncing the workspace.");
  }

  const commitMessage = [
    `Package release ${version} from the current workspace snapshot`,
    "",
    "Constraint: Windows and Linux artifacts are built on native GitHub runners from a temporary snapshot branch",
    "Rejected: Build Windows/Linux locally on Apple Silicon | docker/wine packaging is not stable on this host",
    "Confidence: medium",
    "Scope-risk: moderate",
    "Directive: This snapshot branch is transport-only and should be deleted after the release completes",
    "Tested: local verify/build stages before snapshot creation",
    "Not-tested: remote packaging before workflow execution",
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

async function waitForWorkflowRun(repo, branchName, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const runs = await ghJson([
      "run",
      "list",
      "--repo",
      repo.nameWithOwner,
      "--workflow",
      remoteWorkflowName,
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
  throw new Error(`Timed out waiting for workflow ${remoteWorkflowName} on branch ${branchName}.`);
}

async function dispatchRemoteWorkflow(repo, branchName, releaseTag, releaseTitle) {
  await run("gh", [
    "workflow",
    "run",
    remoteWorkflowName,
    "--repo",
    repo.nameWithOwner,
    "--ref",
    branchName,
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

async function stageRemoteAssets(downloadRoot) {
  const winDir = join(localReleaseDir, "win");
  const linuxDir = join(localReleaseDir, "linux");
  await rm(winDir, { recursive: true, force: true });
  await rm(linuxDir, { recursive: true, force: true });
  await mkdir(winDir, { recursive: true });
  await mkdir(linuxDir, { recursive: true });

  const files = await readdir(downloadRoot);
  for (const fileName of files) {
    const sourcePath = join(downloadRoot, fileName);
    if (fileName.endsWith(".exe") || fileName.endsWith(".blockmap") || fileName === "latest.yml") {
      await cp(sourcePath, join(winDir, fileName));
      continue;
    }
    if (
      fileName.endsWith(".AppImage") ||
      fileName.endsWith(".deb") ||
      fileName.endsWith(".rpm") ||
      fileName === "latest-linux.yml"
    ) {
      await cp(sourcePath, join(linuxDir, fileName));
    }
  }
}

async function uploadWinAndLinuxToR2() {
  await loadEnvFile(join(rootDir, ".env.release.local"));
  await loadEnvFile(join(rootDir, ".env.release"));
  const r2 = await prepareR2ReleaseHost({ rootDir });
  await uploadReleaseFiles({
    rootDir,
    releaseDir: join(localReleaseDir, "win"),
    bucket: r2.bucket,
    releasePrefix: r2.releasePrefix,
  });
  await uploadReleaseFiles({
    rootDir,
    releaseDir: join(localReleaseDir, "linux"),
    bucket: r2.bucket,
    releasePrefix: r2.releasePrefix,
  });
}

async function applyLandingMigrations() {
  const migrationsDir = join(landingDir, "migrations");
  if (!existsSync(migrationsDir)) {
    return;
  }

  const wranglerToml = await readFile(join(landingDir, "wrangler.toml"), "utf8");
  const match = wranglerToml.match(/database_name\s*=\s*"([^"]+)"/);
  if (!match) {
    return;
  }
  const databaseName = match[1];
  const migrationFiles = (await readdir(migrationsDir))
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();

  for (const fileName of migrationFiles) {
    const command = `printf 'y\\n' | npx wrangler d1 execute ${databaseName} --remote --file migrations/${fileName}`;
    await run("bash", ["-lc", command], { cwd: landingDir });
  }
}

async function buildAndDeployLanding() {
  if (!existsSync(join(landingDir, "node_modules"))) {
    await run("npm", ["ci"], { cwd: landingDir });
  }
  await run("npm", ["run", "build"], { cwd: landingDir });
  const deploy = await run(
    "npx",
    ["wrangler", "pages", "deploy", "out", "--project-name", pagesProjectName, "--branch", pagesBranch, "--commit-dirty=true"],
    { cwd: landingDir, capture: true },
  );
  const output = `${deploy.stdout}\n${deploy.stderr}`;
  const urlMatch = output.match(/https:\/\/[^\s]+\.agentcompany\.pages\.dev/);
  return urlMatch?.[0] ?? null;
}

async function verifyPublishedAssets(version, deployUrl) {
  const releaseLinksSource = await readFile(join(landingDir, "components", "release-links.generated.ts"), "utf8");
  const requiredFragments = [
    `AgentCompany-0.4.150-arm64.dmg`.replace("0.4.150", version),
    `AgentCompany.Setup.${version}.exe`,
    `agent-company-${version}.aarch64.rpm`,
    `agent-company_${version}_arm64.deb`,
  ];
  for (const fragment of requiredFragments) {
    if (!releaseLinksSource.includes(fragment)) {
      throw new Error(`Missing expected release asset in generated links: ${fragment}`);
    }
  }

  if (deployUrl) {
    const { stdout } = await run("curl", ["-L", "--silent", "-A", "Mozilla/5.0", deployUrl], { capture: true });
    if (!stdout.includes(version)) {
      throw new Error(`Deployed landing preview ${deployUrl} does not contain version ${version}.`);
    }
  }
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
  await loadEnvFile(join(rootDir, ".env.release.local"));
  await loadEnvFile(join(rootDir, ".env.release"));

  const repo = await getRepoInfo();
  await ensureRemoteBuildPrerequisites(repo);

  const currentVersion = (await readPackageJson()).version;
  const nextVersion = options.version ?? bumpPatchVersion(currentVersion);
  if (!versionPattern.test(nextVersion)) {
    throw new Error(`Invalid version: ${nextVersion}`);
  }

  await updatePackageVersion(nextVersion);
  await resetReleaseStaging();

  if (!options.skipVerify) {
    await run("pnpm", ["verify"]);
  }

  await buildMacAndUpload();

  const timestamp = Date.now();
  const releaseTag = `transport-${nextVersion}-${timestamp}`;
  const branchName = `release-build-${nextVersion.replace(/\./g, "-")}-${timestamp}`;
  const releaseTitle = `Remote Release ${nextVersion}`;

  const tempDir = await createSnapshotBranch(repo, branchName, nextVersion);
  let cleanupPending = true;

  try {
    await dispatchRemoteWorkflow(repo, branchName, releaseTag, releaseTitle);
    const runSummary = await waitForWorkflowRun(repo, branchName, 60_000);
    const runInfo = await waitForWorkflowCompletion(repo, runSummary.databaseId, 45 * 60 * 1000);
    if (runInfo.conclusion !== "success") {
      throw new Error(`Remote workflow failed: ${runInfo.url}`);
    }

    const downloadRoot = await downloadRemoteAssets(repo, releaseTag);
    await stageRemoteAssets(downloadRoot);
    await uploadWinAndLinuxToR2();
    await run("node", ["scripts/generate-landing-release-links.mjs"]);
    await applyLandingMigrations();
    const deployUrl = await buildAndDeployLanding();
    await verifyPublishedAssets(nextVersion, deployUrl);

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
      releaseTag,
      deployUrl,
      updateUrl: process.env.AGENTCOMPANY_UPDATE_URL ?? null,
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
