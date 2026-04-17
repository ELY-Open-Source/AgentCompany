import { spawn } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareR2ReleaseHost, uploadReleaseFiles } from "./release-local/r2.mjs";
import { loadEnvFile } from "./release/lib/dotenv.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const buildReleaseDir = join(rootDir, "build", "release");
const localReleaseDir = join(rootDir, "local-release");
const pnpmVersion = "10.24.0";
const dockerNodeModulesVolume = `${process.cwd().split("/").filter(Boolean).at(-1) ?? "agentcompany"}-node-modules`;

function parseArgs(argv) {
  const options = {
    skipVerify: false,
    upload: true,
    platforms: ["mac", "win", "linux"],
  };
  for (const arg of argv) {
    if (arg === "--skip-verify") {
      options.skipVerify = true;
      continue;
    }
    if (arg === "--no-upload") {
      options.upload = false;
      continue;
    }
    if (arg.startsWith("--platforms=")) {
      options.platforms = arg.slice("--platforms=".length)
        .split(",")
        .map((platform) => platform.trim())
        .filter(Boolean);
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
  console.log(`Usage: node scripts/release-local.mjs [options]

Options:
  --platforms=mac,win,linux   Comma-separated platform list (default: all)
  --skip-verify               Skip pnpm verify before release builds
  --no-upload                 Build artifacts locally without publishing
  --help                      Show this help

Environment loading:
  - .env.release
  - .env.release.local
  - existing shell environment (takes precedence)
`);
}

function hasDocker() {
  return spawnSyncSuccess("docker", ["--version"]);
}

function spawnSyncSuccess(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
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

async function validatePreflight(platforms, upload) {
  if (platforms.includes("mac") && process.platform !== "darwin") {
    throw new Error("Signed macOS release builds must run on macOS.");
  }
  if (platforms.includes("mac") && (!hasMacSigningCredential() || !hasMacNotarizationCredential())) {
    throw new Error(
      "Signed macOS release requires signing credentials (CSC_LINK or CSC_NAME) and notarization credentials " +
      "(APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID or APPLE_API_KEY trio).",
    );
  }
  if ((platforms.includes("win") || platforms.includes("linux")) && !(await hasDocker())) {
    throw new Error("Docker is required to build Windows/Linux locally from this macOS host.");
  }
  if (!upload) {
    return;
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

async function stageRelease(platform) {
  const destination = join(localReleaseDir, platform);
  await rm(destination, { recursive: true, force: true });
  await mkdir(localReleaseDir, { recursive: true });
  await cp(buildReleaseDir, destination, { recursive: true });
  console.log(`[release-local] staged ${platform} artifacts in ${destination}`);
}

function makeDockerEnv(platform) {
  const env = {
    AGENTCOMPANY_ELECTRON_PUBLISH: "never",
    AGENTCOMPANY_UPDATE_URL: process.env.AGENTCOMPANY_UPDATE_URL ?? "",
    AGENTCOMPANY_ELECTRON_DIST: "/root/.cache/electron",
  };
  if (platform === "win") {
    env.CSC_LINK = process.env.WIN_CSC_LINK ?? "";
    env.CSC_KEY_PASSWORD = process.env.WIN_CSC_KEY_PASSWORD ?? "";
  }
  return env;
}

function getDockerBuildCommands(platform) {
  if (platform === "win") {
    return [
      "node scripts/build-desktop.mjs --win nsis --x64 --ia32",
      "node scripts/build-desktop.mjs --win nsis --arm64",
    ];
  }
  return [
    "node scripts/build-desktop.mjs --linux AppImage deb rpm --x64",
    "node scripts/build-desktop.mjs --linux AppImage deb rpm --arm64",
  ];
}

async function runDockerBuild(platform) {
  const isWindows = platform === "win";
  const image = isWindows ? "electronuserland/builder:wine" : "electronuserland/builder";
  const env = makeDockerEnv(platform);
  const cacheDir = join(os.homedir(), ".cache");
  const command = [
    "corepack enable",
    `corepack prepare pnpm@${pnpmVersion} --activate`,
    "pnpm install --frozen-lockfile",
    "pnpm exec electron-vite build",
    ...getDockerBuildCommands(platform),
  ].join(" && ");
  const dockerArgs = [
    "run",
    "--rm",
    "--platform", "linux/amd64",
    "-v", `${rootDir}:/project`,
    "-v", `${dockerNodeModulesVolume}:/project/node_modules`,
    "-v", `${join(cacheDir, "electron")}:/root/.cache/electron`,
    "-v", `${join(cacheDir, "electron-builder")}:/root/.cache/electron-builder`,
    "-w", "/project",
  ];
  for (const [key, value] of Object.entries(env)) {
    dockerArgs.push("-e", `${key}=${value}`);
  }
  dockerArgs.push(image, "/bin/bash", "-lc", command);
  await run("docker", dockerArgs);
}

async function buildMac() {
  const env = {
    ...process.env,
    AGENTCOMPANY_ELECTRON_PUBLISH: "never",
    AGENTCOMPANY_ENABLE_LOCAL_DMG: "true",
    CSC_IDENTITY_AUTO_DISCOVERY: "true",
  };
  await run("pnpm", ["exec", "electron-vite", "build"], env);
  await run("node", ["scripts/build-desktop.mjs", "--mac", "--arm64", "--x64"], env);
  await stageRelease("mac");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await loadEnvFile(join(rootDir, ".env.release.local"));
  await loadEnvFile(join(rootDir, ".env.release"));
  process.env.AGENTCOMPANY_ELECTRON_PUBLISH = "never";
  const r2 = options.upload ? await prepareR2ReleaseHost({ rootDir }) : null;
  await validatePreflight(options.platforms, options.upload);

  console.log(`[release-local] update URL: ${process.env.AGENTCOMPANY_UPDATE_URL}`);
  console.log(`[release-local] upload mode: ${options.upload ? "enabled" : "disabled"}`);
  console.log(`[release-local] platforms: ${options.platforms.join(", ")}`);

  await rm(localReleaseDir, { recursive: true, force: true });
  if (!options.skipVerify) {
    await run("pnpm", ["verify"]);
  }
  if (options.platforms.includes("mac")) {
    await buildMac();
    if (r2) {
      await uploadReleaseFiles({
        rootDir,
        releaseDir: buildReleaseDir,
        bucket: r2.bucket,
        releasePrefix: r2.releasePrefix,
      });
    }
  }
  if (options.platforms.includes("win")) {
    await runDockerBuild("win");
    await stageRelease("win");
    if (r2) {
      await uploadReleaseFiles({
        rootDir,
        releaseDir: buildReleaseDir,
        bucket: r2.bucket,
        releasePrefix: r2.releasePrefix,
      });
    }
  }
  if (options.platforms.includes("linux")) {
    await runDockerBuild("linux");
    await stageRelease("linux");
    if (r2) {
      await uploadReleaseFiles({
        rootDir,
        releaseDir: buildReleaseDir,
        bucket: r2.bucket,
        releasePrefix: r2.releasePrefix,
      });
    }
  }
  await mkdir(localReleaseDir, { recursive: true });
  await writeFile(
    join(localReleaseDir, "manifest.json"),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      platforms: options.platforms,
      uploadEnabled: options.upload,
      updateUrl: process.env.AGENTCOMPANY_UPDATE_URL,
    }, null, 2),
    "utf8",
  );
  console.log(`[release-local] complete. Local artifact staging: ${localReleaseDir}`);
}

await main();
