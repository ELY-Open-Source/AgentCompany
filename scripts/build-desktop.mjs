import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = join(__dirname, "..", "package.json");
const releaseDir = join(__dirname, "..", "build", "release");

const extraArgs = process.argv.slice(2);
const env = { ...process.env };

function bumpPatchVersion(currentVersion) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(currentVersion);
  if (!match) {
    throw new Error(`[build-desktop] Unsupported package version format: ${currentVersion}`);
  }
  const [, major, minor, patch] = match;
  return `${major}.${minor}.${Number.parseInt(patch, 10) + 1}`;
}

async function prepareBuildVersion() {
  const raw = await readFile(packageJsonPath, "utf8");
  const pkg = JSON.parse(raw);
  const nextVersion = bumpPatchVersion(pkg.version);
  pkg.version = nextVersion;
  await writeFile(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  return nextVersion;
}

if (env.CSC_IDENTITY_AUTO_DISCOVERY === undefined) {
  env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
}

const allowedPublishModes = new Set(["always", "never", "onTag", "onTagOrDraft"]);
const explicitPublishArg = extraArgs.some((arg) => arg === "--publish" || arg.startsWith("--publish="));
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

const builderArgs = ["exec", "electron-builder", "--config", "electron-builder.yml"];
if (!explicitPublishArg) {
  builderArgs.push("--publish", publishMode);
}
builderArgs.push(...extraArgs);

await rm(releaseDir, { recursive: true, force: true });
const buildVersion = env.AGENTCOMPANY_BUILD_VERSION?.trim() || await prepareBuildVersion();
env.AGENTCOMPANY_BUILD_VERSION = buildVersion;
env.npm_package_version = buildVersion;
console.log(`[build-desktop] Cleaned build output and bumped package version to ${buildVersion}.`);

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
