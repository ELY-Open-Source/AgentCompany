import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { prepareBuildEnv, resolvePublishMode } from "./build/prepare-env.mjs";
import { resolveBuildVersion, writeRuntimeBuilderConfig } from "./build/emit-builder-config.mjs";
import { buildElectronBuilderArgs, runElectronBuilder } from "./build/run-electron-builder.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const packageJsonPath = join(rootDir, "package.json");
const buildDir = join(rootDir, "build");
const runtimeConfigPath = join(buildDir, "electron-builder.runtime.json");
const localElectronDistPath = join(rootDir, "node_modules", "electron", "dist");
const customMacSignPath = join(__dirname, "electron-builder-mac-sign.mjs");

const extraArgs = process.argv.slice(2);
const prepared = prepareBuildEnv(process.env, extraArgs);
const publishMode = resolvePublishMode(prepared.env);

await rm(buildDir, { recursive: true, force: true });
await mkdir(buildDir, { recursive: true });

const buildVersion = await resolveBuildVersion(packageJsonPath, prepared.env.AGENTCOMPANY_BUILD_VERSION);
await writeRuntimeBuilderConfig({
  rootDir,
  buildDir,
  runtimeConfigPath,
  buildVersion,
  extraArgs,
  prepared,
  customMacSignPath,
  localElectronDistPath,
});
prepared.env.AGENTCOMPANY_BUILD_VERSION = buildVersion;
prepared.env.npm_package_version = buildVersion;
console.log(`[build-desktop] Cleaned ${buildDir} and staged build version ${buildVersion}.`);

const builderArgs = buildElectronBuilderArgs({
  runtimeConfigPath,
  extraArgs,
  publishMode,
  prepared,
});

const result = await runElectronBuilder(builderArgs, prepared.env);
if (result.signal) {
  process.kill(process.pid, result.signal);
} else {
  process.exit(result.code);
}
