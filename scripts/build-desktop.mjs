import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

// electron-builder with `extraMetadata` mutates the source package.json in
// place during packaging and restores it when it finishes. If the process is
// killed mid-flight (CI timeout, Ctrl-C, OOM, parent task cancellation) the
// restore step never fires and the source tree is left with a stripped
// scripts block — every subsequent `pnpm` command then fails until someone
// notices the drift and runs `git checkout`. The snapshot + signal-safe
// restore below is idempotent: on a clean exit electron-builder's own
// restore already wrote the original bytes back and this is a no-op; on
// any abnormal termination we guarantee the working tree is clean.
const packageJsonSnapshot = await readFile(packageJsonPath);
let packageJsonRestored = false;
async function restorePackageJsonIfNeeded() {
  if (packageJsonRestored) return;
  packageJsonRestored = true;
  try {
    const current = await readFile(packageJsonPath);
    if (current.equals(packageJsonSnapshot)) return;
    await writeFile(packageJsonPath, packageJsonSnapshot);
    console.log("[build-desktop] Restored package.json from snapshot after builder left it mutated.");
  } catch (error) {
    console.error(`[build-desktop] Failed to restore package.json snapshot: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
const signalHandlers = new Map();
for (const signal of signals) {
  const handler = () => {
    void restorePackageJsonIfNeeded().finally(() => {
      process.kill(process.pid, signal);
    });
  };
  signalHandlers.set(signal, handler);
  process.once(signal, handler);
}

try {
  const result = await runElectronBuilder(builderArgs, prepared.env);
  await restorePackageJsonIfNeeded();
  for (const [signal, handler] of signalHandlers) process.off(signal, handler);
  if (result.signal) {
    process.kill(process.pid, result.signal);
  } else {
    process.exit(result.code);
  }
} catch (error) {
  await restorePackageJsonIfNeeded();
  throw error;
}
