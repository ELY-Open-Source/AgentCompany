import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = join(__dirname, "..", "package.json");
const buildDir = join(__dirname, "..", "build");
const releaseDir = join(buildDir, "release");
const runtimeConfigPath = join(buildDir, "electron-builder.runtime.json");

const extraArgs = process.argv.slice(2);
const env = { ...process.env };
const hasMacSigningMaterial = Boolean(
  env.CSC_LINK?.trim() ||
  env.CSC_NAME?.trim() ||
  env.APPLE_API_KEY?.trim(),
);

function bumpPatchVersion(currentVersion) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(currentVersion);
  if (!match) {
    throw new Error(`[build-desktop] Unsupported package version format: ${currentVersion}`);
  }
  const [, major, minor, patch] = match;
  return `${major}.${minor}.${Number.parseInt(patch, 10) + 1}`;
}

async function resolveBuildVersion() {
  const raw = await readFile(packageJsonPath, "utf8");
  const pkg = JSON.parse(raw);
  const nextVersion = bumpPatchVersion(pkg.version);
  return nextVersion;
}

async function writeRuntimeConfig(buildVersion) {
  const runtimeConfig = {
    extends: join(__dirname, "..", "electron-builder.yml"),
    directories: {
      output: releaseDir,
    },
    extraMetadata: {
      version: buildVersion,
    },
  };
  if (process.platform === "darwin" && !hasMacSigningMaterial && env.AGENTCOMPANY_ENABLE_LOCAL_DMG !== "true") {
    runtimeConfig.mac = {
      target: ["zip"],
      hardenedRuntime: false,
    };
  } else if (process.platform === "darwin") {
    runtimeConfig.mac = {
      hardenedRuntime: true,
    };
  }
  await writeFile(runtimeConfigPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`, "utf8");
}

if (env.CSC_IDENTITY_AUTO_DISCOVERY === undefined) {
  env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
}

const allowedPublishModes = new Set(["always", "never", "onTag", "onTagOrDraft"]);
const explicitPublishArg = extraArgs.some((arg) => arg === "--publish" || arg.startsWith("--publish="));
const explicitPlatformArg = extraArgs.some((arg) =>
  arg === "--mac" ||
  arg === "--win" ||
  arg === "--linux" ||
  arg === "-m" ||
  arg === "-w" ||
  arg === "-l" ||
  arg.startsWith("--mac=") ||
  arg.startsWith("--win=") ||
  arg.startsWith("--linux="),
);
const requestedPublishMode = env.AGENTCOMPANY_ELECTRON_PUBLISH?.trim();
let publishMode = "never";

if (requestedPublishMode) {
  if (!allowedPublishModes.has(requestedPublishMode)) {
    console.warn(
      `[build-desktop] Ignoring invalid AGENTCOMPANY_ELECTRON_PUBLISH="${requestedPublishMode}". ` +
        "Falling back to --publish never.",
    );
  } else {
    publishMode = requestedPublishMode;
  }
}

const builderArgs = ["exec", "electron-builder", "--config", runtimeConfigPath];
if (!explicitPublishArg) {
  builderArgs.push("--publish", publishMode);
}
if (process.platform === "darwin" && !hasMacSigningMaterial && env.AGENTCOMPANY_ENABLE_LOCAL_DMG !== "true" && !explicitPlatformArg) {
  builderArgs.push("--mac", "zip");
}
builderArgs.push(...extraArgs);

await rm(buildDir, { recursive: true, force: true });
await mkdir(buildDir, { recursive: true });
const buildVersion = env.AGENTCOMPANY_BUILD_VERSION?.trim() || await resolveBuildVersion();
await writeRuntimeConfig(buildVersion);
env.AGENTCOMPANY_BUILD_VERSION = buildVersion;
env.npm_package_version = buildVersion;
console.log(`[build-desktop] Cleaned ${buildDir} and staged non-mutating build version ${buildVersion}.`);

const child = spawn("pnpm", builderArgs, {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
