import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

function validateBuildVersion(currentVersion) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(currentVersion);
  if (!match) {
    throw new Error(`[build-desktop] Unsupported package version format: ${currentVersion}`);
  }
  return currentVersion;
}

export async function resolveBuildVersion(packageJsonPath, override) {
  if (override?.trim()) return validateBuildVersion(override.trim());
  const raw = await readFile(packageJsonPath, "utf8");
  const pkg = JSON.parse(raw);
  return validateBuildVersion(pkg.version);
}

export function hasExplicitArchArg(args) {
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

function resolveCurrentMacArch(env, extraArgs) {
  if (process.platform !== "darwin" || env.AGENTCOMPANY_MAC_ALL_ARCHES === "true" || hasExplicitArchArg(extraArgs)) {
    return null;
  }
  return process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : null;
}

export async function writeRuntimeBuilderConfig({
  rootDir,
  buildDir,
  runtimeConfigPath,
  buildVersion,
  extraArgs,
  prepared,
  customMacSignPath,
  localElectronDistPath,
}) {
  const { env, resolvedUpdateUrl, hasR2PublishConfig, hasMacSigningMaterial, strictRelease, isDirBuild, explicitElectronDistPath, r2 } = prepared;
  const forcedMacArch = resolveCurrentMacArch(env, extraArgs);
  const isUnsignedLocalMacBuild = (
    process.platform === "darwin" &&
    !hasMacSigningMaterial &&
    env.AGENTCOMPANY_ENABLE_LOCAL_DMG !== "true"
  );

  const releaseDir = join(buildDir, "release");
  const runtimeConfig = {
    extends: join(rootDir, "electron-builder.yml"),
    directories: { output: releaseDir },
    extraMetadata: { version: buildVersion },
  };

  if (explicitElectronDistPath) {
    runtimeConfig.electronDist = explicitElectronDistPath;
  } else if (isDirBuild) {
    runtimeConfig.electronDist = localElectronDistPath;
  }

  if (hasR2PublishConfig) {
    runtimeConfig.publish = [{
      provider: "s3",
      bucket: r2.bucket,
      endpoint: r2.endpoint,
      region: r2.region,
      path: r2.path || undefined,
      acl: null,
      publishAutoUpdate: true,
    }];
  } else if (resolvedUpdateUrl) {
    runtimeConfig.publish = [{ provider: "generic", url: resolvedUpdateUrl }];
  }

  if (isUnsignedLocalMacBuild) {
    if (strictRelease) {
      throw new Error("[build-desktop] Strict release mode requires macOS signing/notarization material.");
    }
    runtimeConfig.mac = { hardenedRuntime: false, identity: null };
    if (!isDirBuild) {
      runtimeConfig.mac.target = forcedMacArch
        ? [{ target: "zip", arch: [forcedMacArch] }]
        : ["zip"];
    }
  } else if (process.platform === "darwin" && !hasMacSigningMaterial) {
    runtimeConfig.mac = { hardenedRuntime: false, identity: null };
  } else if (process.platform === "darwin") {
    runtimeConfig.mac = { hardenedRuntime: true };
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

  if (strictRelease && !resolvedUpdateUrl) {
    throw new Error("[build-desktop] Strict release mode requires AGENTCOMPANY_UPDATE_URL or an R2 public URL to be configured.");
  }

  await writeFile(runtimeConfigPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`, "utf8");
  return { forcedMacArch, isUnsignedLocalMacBuild };
}
