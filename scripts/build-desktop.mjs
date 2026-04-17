import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = join(__dirname, "..", "package.json");
const buildDir = join(__dirname, "..", "build");
const releaseDir = join(buildDir, "release");
const runtimeConfigPath = join(buildDir, "electron-builder.runtime.json");
const localElectronDistPath = join(__dirname, "..", "node_modules", "electron", "dist");
const customMacSignPath = join(__dirname, "electron-builder-mac-sign.mjs");

const extraArgs = process.argv.slice(2);
const env = { ...process.env };
const explicitElectronDistPath = env.AGENTCOMPANY_ELECTRON_DIST?.trim() || "";
const noDeprecationFlag = "--no-deprecation";
const requestedUpdateUrl = env.AGENTCOMPANY_UPDATE_URL?.trim() ?? "";
const strictRelease = env.AGENTCOMPANY_STRICT_RELEASE === "true";
const hasMacSigningMaterial = Boolean(
  env.CSC_LINK?.trim() ||
  env.CSC_NAME?.trim() ||
  env.APPLE_API_KEY?.trim(),
);
const isDirBuild = extraArgs.includes("--dir");
const r2AccountId = env.AGENTCOMPANY_R2_ACCOUNT_ID?.trim() ?? env.R2_ACCOUNT_ID?.trim() ?? "";
const r2Bucket = env.AGENTCOMPANY_R2_BUCKET?.trim() ?? env.R2_BUCKET?.trim() ?? "";
const r2PublicUrl = env.AGENTCOMPANY_R2_PUBLIC_URL?.trim() ?? env.R2_PUBLIC_BASE_URL?.trim() ?? "";
const r2Path = env.AGENTCOMPANY_R2_PATH?.trim() ?? env.AGENTCOMPANY_RELEASE_PREFIX?.trim() ?? "desktop";
const r2Region = env.AGENTCOMPANY_R2_REGION?.trim() || "auto";
const r2Endpoint = env.AGENTCOMPANY_R2_ENDPOINT?.trim() || (r2AccountId ? `https://${r2AccountId}.r2.cloudflarestorage.com` : "");
const filteredUnsignedMacWarningSnippets = [
  "skipped macOS code signing  reason=identity explicitly is set to null",
  "arm64 requires signing, but identity is set to null and signing is being skipped",
];

function validateBuildVersion(currentVersion) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(currentVersion);
  if (!match) {
    throw new Error(`[build-desktop] Unsupported package version format: ${currentVersion}`);
  }
  return currentVersion;
}

function normalizeBaseUrl(url) {
  return url.replace(/\/+$/, "");
}

function normalizePublishPath(targetPath) {
  return targetPath.replace(/^\/+|\/+$/g, "");
}

function resolveUpdateUrl() {
  if (requestedUpdateUrl && !requestedUpdateUrl.includes("example.invalid")) {
    return normalizeBaseUrl(requestedUpdateUrl);
  }
  if (!r2PublicUrl) {
    return "";
  }
  const baseUrl = normalizeBaseUrl(r2PublicUrl);
  const publishPath = normalizePublishPath(r2Path);
  return publishPath ? `${baseUrl}/${publishPath}` : baseUrl;
}

const resolvedUpdateUrl = resolveUpdateUrl();
const hasR2PublishConfig = Boolean(
  r2Bucket &&
  r2Endpoint &&
  resolvedUpdateUrl &&
  (env.AGENTCOMPANY_R2_ACCESS_KEY_ID?.trim() || env.R2_ACCESS_KEY_ID?.trim() || env.AWS_ACCESS_KEY_ID?.trim()) &&
  (env.AGENTCOMPANY_R2_SECRET_ACCESS_KEY?.trim() || env.R2_SECRET_ACCESS_KEY?.trim() || env.AWS_SECRET_ACCESS_KEY?.trim()),
);

if (!env.AWS_ACCESS_KEY_ID && (env.AGENTCOMPANY_R2_ACCESS_KEY_ID?.trim() || env.R2_ACCESS_KEY_ID?.trim())) {
  env.AWS_ACCESS_KEY_ID = env.AGENTCOMPANY_R2_ACCESS_KEY_ID?.trim() || env.R2_ACCESS_KEY_ID?.trim();
}
if (!env.AWS_SECRET_ACCESS_KEY && (env.AGENTCOMPANY_R2_SECRET_ACCESS_KEY?.trim() || env.R2_SECRET_ACCESS_KEY?.trim())) {
  env.AWS_SECRET_ACCESS_KEY = env.AGENTCOMPANY_R2_SECRET_ACCESS_KEY?.trim() || env.R2_SECRET_ACCESS_KEY?.trim();
}
if (!env.AWS_REGION) {
  env.AWS_REGION = r2Region;
}
if (!env.AWS_DEFAULT_REGION) {
  env.AWS_DEFAULT_REGION = env.AWS_REGION;
}
if (!env.AWS_EC2_METADATA_DISABLED) {
  env.AWS_EC2_METADATA_DISABLED = "true";
}
if (!env.AGENTCOMPANY_UPDATE_URL && resolvedUpdateUrl) {
  env.AGENTCOMPANY_UPDATE_URL = resolvedUpdateUrl;
}

function resolveCurrentPlatformArg() {
  switch (process.platform) {
    case "darwin":
      return "--mac";
    case "win32":
      return "--win";
    default:
      return "--linux";
  }
}

function resolveCurrentArchArg() {
  switch (process.arch) {
    case "arm64":
      return "--arm64";
    case "x64":
      return "--x64";
    default:
      return null;
  }
}

function hasExplicitArchArg(args) {
  return args.some((arg) =>
    arg === "--arm64" ||
    arg === "--x64" ||
    arg === "--ia32" ||
    arg === "--universal" ||
    arg.startsWith("--arm64=") ||
    arg.startsWith("--x64=") ||
    arg.startsWith("--ia32=") ||
    arg.startsWith("--universal="),
  );
}

function resolveCurrentMacArch() {
  if (process.platform !== "darwin" || env.AGENTCOMPANY_MAC_ALL_ARCHES === "true" || hasExplicitArchArg(extraArgs)) {
    return null;
  }
  return process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : null;
}

async function resolveBuildVersion() {
  const raw = await readFile(packageJsonPath, "utf8");
  const pkg = JSON.parse(raw);
  return validateBuildVersion(pkg.version);
}

async function writeRuntimeConfig(buildVersion) {
  const forcedMacArch = resolveCurrentMacArch();
  const isUnsignedLocalMacBuild = (
    process.platform === "darwin" &&
    !hasMacSigningMaterial &&
    env.AGENTCOMPANY_ENABLE_LOCAL_DMG !== "true"
  );
  const runtimeConfig = {
    extends: join(__dirname, "..", "electron-builder.yml"),
    directories: {
      output: releaseDir,
    },
    extraMetadata: {
      version: buildVersion,
    },
  };
  if (explicitElectronDistPath) {
    runtimeConfig.electronDist = explicitElectronDistPath;
  } else if (isDirBuild) {
    runtimeConfig.electronDist = localElectronDistPath;
  }
  if (hasR2PublishConfig) {
    runtimeConfig.publish = [
      {
        provider: "s3",
        bucket: r2Bucket,
        endpoint: r2Endpoint,
        region: r2Region,
        path: normalizePublishPath(r2Path) || undefined,
        acl: null,
        publishAutoUpdate: true,
      },
    ];
  } else if (resolvedUpdateUrl) {
    runtimeConfig.publish = [
      {
        provider: "generic",
        url: resolvedUpdateUrl,
      },
    ];
  }
  if (isUnsignedLocalMacBuild) {
    if (strictRelease) {
      throw new Error("[build-desktop] Strict release mode requires macOS signing/notarization material.");
    }
    runtimeConfig.mac = {
      hardenedRuntime: false,
      identity: null,
    };
    if (!isDirBuild) {
      runtimeConfig.mac.target = forcedMacArch
        ? [{ target: "zip", arch: [forcedMacArch] }]
        : ["zip"];
    }
  } else if (process.platform === "darwin" && !hasMacSigningMaterial) {
    runtimeConfig.mac = {
      hardenedRuntime: false,
      identity: null,
    };
  } else if (process.platform === "darwin") {
    runtimeConfig.mac = {
      hardenedRuntime: true,
    };
    if (hasMacSigningMaterial) {
      runtimeConfig.mac.sign = customMacSignPath;
    }
  }
  if (process.platform === "darwin" && !isDirBuild && forcedMacArch && !isUnsignedLocalMacBuild) {
    runtimeConfig.mac ??= {};
    runtimeConfig.mac.target = [
      { target: "dmg", arch: [forcedMacArch] },
      { target: "zip", arch: [forcedMacArch] },
    ];
  }
  await writeFile(runtimeConfigPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`, "utf8");
}

if (env.CSC_IDENTITY_AUTO_DISCOVERY === undefined) {
  env.CSC_IDENTITY_AUTO_DISCOVERY = hasMacSigningMaterial ? "true" : "false";
}

const existingNodeOptions = env.NODE_OPTIONS?.trim();
if (!existingNodeOptions) {
  env.NODE_OPTIONS = noDeprecationFlag;
} else if (!existingNodeOptions.includes(noDeprecationFlag)) {
  env.NODE_OPTIONS = `${existingNodeOptions} ${noDeprecationFlag}`;
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
const explicitArchArg = hasExplicitArchArg(extraArgs);
const shouldForceLocalMacZip = (
  process.platform === "darwin" &&
  !hasMacSigningMaterial &&
  env.AGENTCOMPANY_ENABLE_LOCAL_DMG !== "true" &&
  !explicitPlatformArg &&
  !isDirBuild
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
if (!explicitPlatformArg) {
  builderArgs.push(resolveCurrentPlatformArg());
}
if (!explicitArchArg) {
  const currentArchArg = resolveCurrentArchArg();
  if (currentArchArg) {
    builderArgs.push(currentArchArg);
  }
}
if (shouldForceLocalMacZip) {
  builderArgs.push("zip");
}
builderArgs.push(...extraArgs);

if (strictRelease && !resolvedUpdateUrl) {
  throw new Error("[build-desktop] Strict release mode requires AGENTCOMPANY_UPDATE_URL or an R2 public URL to be configured.");
}
if (publishMode !== "never" && !hasR2PublishConfig && !resolvedUpdateUrl) {
  throw new Error(
    "[build-desktop] Publishing requires either AGENTCOMPANY_UPDATE_URL (generic feed only) " +
    "or full Cloudflare R2 publish configuration.",
  );
}

const transientBuildFailurePatterns = [
  /chmod .*Electron Framework.*no such file or directory/i,
];

function shouldRetryElectronBuilder(output) {
  return transientBuildFailurePatterns.some((pattern) => pattern.test(output));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldSuppressBuildLine(line) {
  return filteredUnsignedMacWarningSnippets.some((snippet) => line.includes(snippet));
}

function forwardChildOutput(stream, writer, onLine) {
  if (!stream) return;
  let pending = "";
  stream.on("data", (chunk) => {
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      onLine(line);
      if (!shouldSuppressBuildLine(line)) {
        writer.write(`${line}\n`);
      }
    }
  });
  stream.on("end", () => {
    if (!pending) return;
    onLine(pending);
    if (!shouldSuppressBuildLine(pending)) {
      writer.write(`${pending}\n`);
    }
  });
}

function runElectronBuilder() {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", builderArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env,
      shell: process.platform === "win32",
    });
    let output = "";
    const appendOutputLine = (line) => {
      output += `${line}\n`;
    };
    forwardChildOutput(child.stdout, process.stdout, appendOutputLine);
    forwardChildOutput(child.stderr, process.stderr, appendOutputLine);

    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({ code: code ?? 1, signal, output });
    });
  });
}

await rm(buildDir, { recursive: true, force: true });
await mkdir(buildDir, { recursive: true });
const buildVersion = env.AGENTCOMPANY_BUILD_VERSION?.trim() || await resolveBuildVersion();
await writeRuntimeConfig(buildVersion);
env.AGENTCOMPANY_BUILD_VERSION = buildVersion;
env.npm_package_version = buildVersion;
console.log(`[build-desktop] Cleaned ${buildDir} and staged build version ${buildVersion}.`);
for (let attempt = 0; attempt < 2; attempt++) {
  try {
    const result = await runElectronBuilder();
    if (result.signal) {
      process.kill(process.pid, result.signal);
      break;
    }
    if (result.code === 0) {
      process.exit(0);
    }
    if (attempt === 0 && shouldRetryElectronBuilder(result.output)) {
      console.warn("[build-desktop] electron-builder hit a transient macOS framework extraction error; retrying once.");
      await delay(1000);
      continue;
    }
    process.exit(result.code);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
