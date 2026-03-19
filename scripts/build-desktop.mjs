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
const requestedUpdateUrl = env.AGENTCOMPANY_UPDATE_URL?.trim() ?? "";
const strictRelease = env.AGENTCOMPANY_STRICT_RELEASE === "true";
const hasMacSigningMaterial = Boolean(
  env.CSC_LINK?.trim() ||
  env.CSC_NAME?.trim() ||
  env.APPLE_API_KEY?.trim(),
);
const isDirBuild = extraArgs.includes("--dir");

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
  if (requestedUpdateUrl) {
    runtimeConfig.publish = [
      {
        provider: "generic",
        url: requestedUpdateUrl,
      },
    ];
  }
  if (process.platform === "darwin" && !hasMacSigningMaterial && env.AGENTCOMPANY_ENABLE_LOCAL_DMG !== "true") {
    if (strictRelease) {
      throw new Error("[build-desktop] Strict release mode requires macOS signing/notarization material.");
    }
    runtimeConfig.mac = {
      hardenedRuntime: false,
    };
    if (!isDirBuild) {
      runtimeConfig.mac.target = ["zip"];
    }
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
if (
  process.platform === "darwin" &&
  !hasMacSigningMaterial &&
  env.AGENTCOMPANY_ENABLE_LOCAL_DMG !== "true" &&
  !explicitPlatformArg &&
  !isDirBuild
) {
  builderArgs.push("--mac", "zip");
}
builderArgs.push(...extraArgs);

if (strictRelease && !requestedUpdateUrl) {
  throw new Error("[build-desktop] Strict release mode requires AGENTCOMPANY_UPDATE_URL to be configured.");
}

// On Windows, antivirus scanners may hold file locks on .asar/.exe files.
// Retry the rm with increasing delays to give the OS time to release them.
for (let attempt = 0; attempt < 5; attempt++) {
  try {
    await rm(buildDir, { recursive: true, force: true });
    break;
  } catch (rmErr) {
    if (attempt < 4 && rmErr.code === "EBUSY") {
      const delay = (attempt + 1) * 3000;
      console.log(`[build-desktop] Build dir locked (EBUSY), retrying in ${delay / 1000}s... (attempt ${attempt + 1}/5)`);
      await new Promise((r) => setTimeout(r, delay));
    } else {
      throw rmErr;
    }
  }
}
await mkdir(buildDir, { recursive: true });
const buildVersion = env.AGENTCOMPANY_BUILD_VERSION?.trim() || await resolveBuildVersion();
const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
if (packageJson.version !== buildVersion) {
  packageJson.version = buildVersion;
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
}
await writeRuntimeConfig(buildVersion);
env.AGENTCOMPANY_BUILD_VERSION = buildVersion;
env.npm_package_version = buildVersion;
console.log(`[build-desktop] Cleaned ${buildDir} and staged build version ${buildVersion}.`);

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
