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
  const options = { version: null, skipBoss: false, only: null };
  for (const arg of argv) {
    if (arg.startsWith("--version=")) {
      options.version = arg.slice("--version=".length).trim();
      continue;
    }
    if (arg === "--skip-boss") {
      options.skipBoss = true;
      continue;
    }
    if (arg === "--win-only") {
      options.only = "win";
      continue;
    }
    if (arg === "--linux-only") {
      options.only = "linux";
      continue;
    }
    if (arg === "--help") {
      console.log(`Usage: node scripts/release-local-winlinux.mjs [options]

Options:
  --version=x.y.z   Override version (defaults to current package.json).
  --win-only        Build and upload Windows only.
  --linux-only      Build and upload Linux only.
  --skip-boss       Skip Boss Windows EXE build.
  --help            Show this help.

Environment:
  On Windows host: Windows builds run natively via electron-builder.
  On any host: Linux builds run through Docker + electronuserland/builder image.
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

function hasDockerInstalled() {
  return new Promise((resolve) => {
    const child = spawn("docker", ["--version"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function buildPublicWinNative() {
  const env = {
    ...process.env,
    AGENTCOMPANY_ELECTRON_PUBLISH: "never",
    CSC_LINK: process.env.WIN_CSC_LINK ?? "",
    CSC_KEY_PASSWORD: process.env.WIN_CSC_KEY_PASSWORD ?? "",
  };
  await run("pnpm", ["exec", "electron-vite", "build"], env);
  await run("node", ["scripts/build-desktop.mjs", "--win", "nsis", "--x64"], env);
  await run("node", ["scripts/build-desktop.mjs", "--win", "nsis", "--arm64"], env);
}

async function buildPublicLinuxDocker() {
  if (!(await hasDockerInstalled())) {
    throw new Error("Docker is required for Linux builds. Install Docker Desktop and retry.");
  }
  // Reuse the existing Docker-based Linux build path from release-local.mjs by
  // shelling into it with --platforms=linux --no-upload. That keeps one source
  // of truth for the container mounts.
  await run("node", [
    "scripts/release-local.mjs",
    "--platforms=linux",
    "--no-upload",
    "--skip-verify",
  ]);
}

async function stage(platform) {
  const destination = join(localReleaseDir, platform);
  await rm(destination, { recursive: true, force: true });
  await mkdir(localReleaseDir, { recursive: true });
  await run(process.platform === "win32" ? "xcopy" : "cp", process.platform === "win32"
    ? [buildReleaseDir, destination, "/E", "/I", "/Y"]
    : ["-R", buildReleaseDir, destination]);
  console.log(`[release-local-winlinux] staged ${platform} artifacts in ${destination}`);
  return destination;
}

async function buildBossWin(version) {
  if (process.platform !== "win32") {
    throw new Error("Boss Windows EXE build must run on Windows (electron-builder --win native).");
  }
  await run("node", ["boss-build/build-boss-edition.mjs", `--platform=win`, `--version=${version}`]);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await loadEnvFile(join(rootDir, ".env.release.local"));
  await loadEnvFile(join(rootDir, ".env.release"));
  process.env.AGENTCOMPANY_ELECTRON_PUBLISH = "never";

  const pkgVersion = (await readPackageJson()).version;
  const nextVersion = options.version ?? pkgVersion;
  if (!versionPattern.test(nextVersion)) throw new Error(`Invalid version: ${nextVersion}`);
  if (nextVersion !== pkgVersion) {
    console.log(`[release-local-winlinux] version override: ${pkgVersion} -> ${nextVersion}`);
  }

  await rm(localReleaseDir, { recursive: true, force: true });
  await rm(buildReleaseDir, { recursive: true, force: true });

  const r2 = await prepareR2ReleaseHost({ rootDir });
  console.log(`[release-local-winlinux] update URL: ${process.env.AGENTCOMPANY_UPDATE_URL}`);
  console.log(`[release-local-winlinux] version: ${nextVersion}`);

  // Purge only Win+Linux artifacts — Mac files (owned by release-local-mac) stay put.
  const keepClasses = options.only === "win"
    ? ["mac", "linux", "other"]
    : options.only === "linux"
      ? ["mac", "win", "other"]
      : ["mac", "other"];
  await purgeReleasePrefix({
    bucket: r2.bucket,
    releasePrefix: r2.releasePrefix,
    keep: keepClasses,
  });

  if (options.only !== "linux") {
    if (process.platform !== "win32") {
      throw new Error(
        "release:local-winlinux Windows builds must run on a Windows host. " +
        "Use --linux-only on non-Windows machines, or run the full command on the Windows box.",
      );
    }
    await buildPublicWinNative();
    await stage("win");
    await uploadReleaseFiles({
      rootDir,
      releaseDir: join(localReleaseDir, "win"),
      bucket: r2.bucket,
      releasePrefix: r2.releasePrefix,
    });
  }

  if (options.only !== "win") {
    await buildPublicLinuxDocker();
    // release-local.mjs already staged into local-release/linux when it ran.
    // Upload from there so we do not wipe the staged tree.
    await uploadReleaseFiles({
      rootDir,
      releaseDir: join(localReleaseDir, "linux"),
      bucket: r2.bucket,
      releasePrefix: r2.releasePrefix,
    });
  }

  if (!options.skipBoss && options.only !== "linux" && process.platform === "win32") {
    await buildBossWin(nextVersion);
  }

  await mkdir(localReleaseDir, { recursive: true });
  await writeFile(
    join(localReleaseDir, "manifest.json"),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      command: "release:local-winlinux",
      version: nextVersion,
      only: options.only,
      updateUrl: process.env.AGENTCOMPANY_UPDATE_URL,
    }, null, 2),
    "utf8",
  );

  const bossFiles = options.skipBoss || process.platform !== "win32"
    ? []
    : (await readdir(join(rootDir, "boss-build", "build", "out")).catch(() => []))
        .filter((name) => name.endsWith(".exe"));

  console.log(JSON.stringify({
    version: nextVersion,
    only: options.only,
    updateUrl: process.env.AGENTCOMPANY_UPDATE_URL,
    bossArtifacts: bossFiles,
  }, null, 2));
}

await main();
