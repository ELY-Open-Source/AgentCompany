import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareR2ReleaseHost, purgeReleasePrefix, uploadReleaseFiles } from "./release-local/r2.mjs";
import { loadEnvFile } from "./release/lib/dotenv.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const packageJsonPath = join(rootDir, "package.json");
const buildReleaseDir = join(rootDir, "build", "release");
const localReleaseDir = join(rootDir, "local-release");
const versionPattern = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

function parseArgs(argv) {
  const options = { version: null, skipBoss: false, bump: true };
  for (const arg of argv) {
    if (arg.startsWith("--version=")) {
      options.version = arg.slice("--version=".length).trim();
      options.bump = false;
      continue;
    }
    if (arg === "--no-bump") {
      options.bump = false;
      continue;
    }
    if (arg === "--skip-boss") {
      options.skipBoss = true;
      continue;
    }
    if (arg === "--help") {
      console.log(`Usage: node scripts/release-local-mac.mjs [options]

Options:
  --version=x.y.z   Explicit version (disables auto-bump).
  --no-bump         Use current package.json version without bumping.
  --skip-boss       Build public Mac only; skip Boss DMG.
  --help            Show this help.
`);
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function readPackageJson() {
  return JSON.parse(await readFile(packageJsonPath, "utf8"));
}

function bumpPatchVersion(version) {
  const match = versionPattern.exec(version);
  if (!match) throw new Error(`Unsupported package version format: ${version}`);
  const [, major, minor, patch] = match;
  return `${major}.${minor}.${Number.parseInt(patch, 10) + 1}`;
}

async function updatePackageVersion(nextVersion) {
  const pkg = await readPackageJson();
  pkg.version = nextVersion;
  await writeFile(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

function hasMacSigningCredential() {
  return Boolean(process.env.CSC_LINK?.trim() || process.env.CSC_NAME?.trim());
}

function hasMacNotarizationCredential() {
  return Boolean(
    (process.env.APPLE_ID?.trim() &&
      process.env.APPLE_APP_SPECIFIC_PASSWORD?.trim() &&
      process.env.APPLE_TEAM_ID?.trim()) ||
    (process.env.APPLE_API_KEY?.trim() &&
      process.env.APPLE_API_KEY_ID?.trim() &&
      process.env.APPLE_API_ISSUER?.trim()),
  );
}

function validatePreflight() {
  if (process.platform !== "darwin") {
    throw new Error("release:local-mac must run on macOS for signed Mac builds.");
  }
  if (!hasMacSigningCredential() || !hasMacNotarizationCredential()) {
    throw new Error(
      "Missing Mac signing/notarization credentials. Set CSC_LINK (or CSC_NAME) and " +
      "APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID or the APPLE_API_KEY trio.",
    );
  }
}

async function run(command, args, env = process.env) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code ?? 1}`));
    });
  });
}

async function buildPublicMac() {
  const env = {
    ...process.env,
    AGENTCOMPANY_ELECTRON_PUBLISH: "never",
    AGENTCOMPANY_ENABLE_LOCAL_DMG: "true",
    CSC_IDENTITY_AUTO_DISCOVERY: "true",
  };
  await run("pnpm", ["exec", "electron-vite", "build"], env);
  await run("node", ["scripts/build-desktop.mjs", "--mac", "--arm64", "--x64"], env);
}

async function stageMac() {
  const destination = join(localReleaseDir, "mac");
  await rm(destination, { recursive: true, force: true });
  await mkdir(localReleaseDir, { recursive: true });
  await run("cp", ["-R", buildReleaseDir, destination]);
  console.log(`[release-local-mac] staged mac artifacts in ${destination}`);
  return destination;
}

async function buildBossMac(version) {
  await run("node", ["boss-build/build-boss-edition.mjs", `--platform=mac`, `--version=${version}`]);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await loadEnvFile(join(rootDir, ".env.release.local"));
  await loadEnvFile(join(rootDir, ".env.release"));
  process.env.AGENTCOMPANY_ELECTRON_PUBLISH = "never";

  validatePreflight();

  const currentVersion = (await readPackageJson()).version;
  const nextVersion = options.version ?? (options.bump ? bumpPatchVersion(currentVersion) : currentVersion);
  if (!versionPattern.test(nextVersion)) throw new Error(`Invalid version: ${nextVersion}`);
  if (nextVersion !== currentVersion) await updatePackageVersion(nextVersion);

  await rm(localReleaseDir, { recursive: true, force: true });
  await rm(buildReleaseDir, { recursive: true, force: true });

  const r2 = await prepareR2ReleaseHost({ rootDir });
  console.log(`[release-local-mac] update URL: ${process.env.AGENTCOMPANY_UPDATE_URL}`);
  console.log(`[release-local-mac] version: ${nextVersion}`);

  // Purge only Mac artifacts — Win/Linux (from the Windows release script) stay put.
  await purgeReleasePrefix({
    bucket: r2.bucket,
    releasePrefix: r2.releasePrefix,
    keep: ["win", "linux", "other"],
  });

  await buildPublicMac();
  await stageMac();
  await uploadReleaseFiles({
    rootDir,
    releaseDir: buildReleaseDir,
    bucket: r2.bucket,
    releasePrefix: r2.releasePrefix,
  });

  if (!options.skipBoss) {
    await buildBossMac(nextVersion);
  }

  await mkdir(localReleaseDir, { recursive: true });
  await writeFile(
    join(localReleaseDir, "manifest.json"),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      command: "release:local-mac",
      version: nextVersion,
      updateUrl: process.env.AGENTCOMPANY_UPDATE_URL,
    }, null, 2),
    "utf8",
  );

  const bossFiles = options.skipBoss
    ? []
    : (await readdir(join(rootDir, "boss-build", "build", "out")).catch(() => []))
        .filter((name) => name.endsWith(".dmg") || name.endsWith(".zip"));

  console.log(JSON.stringify({
    version: nextVersion,
    updateUrl: process.env.AGENTCOMPANY_UPDATE_URL,
    macStagedIn: join(localReleaseDir, "mac"),
    bossArtifacts: bossFiles,
  }, null, 2));
}

await main();
