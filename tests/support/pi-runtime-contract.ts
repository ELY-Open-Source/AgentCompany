import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const PI_RUNTIME_VERSION = "0.67.68";

export const PI_RUNTIME_PACKAGES = [
  "@mariozechner/pi-agent-core",
  "@mariozechner/pi-ai",
  "@mariozechner/pi-coding-agent",
] as const;

export type PiRuntimePackage = typeof PI_RUNTIME_PACKAGES[number];

export type PackageJson = {
  dependencies?: Record<string, string>;
  version?: string;
};

export function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function readRootPackage(): PackageJson {
  return readJsonFile(join(process.cwd(), "package.json"));
}

export function readPnpmLockfile(): string {
  return readFileSync(join(process.cwd(), "pnpm-lock.yaml"), "utf8");
}

export function lockfileHasImporterPin(
  lockfile: string,
  packageName: PiRuntimePackage,
  version: string,
): boolean {
  return lockfile.includes([
    `      '${packageName}':`,
    `        specifier: ${version}`,
    `        version: ${version}(`,
  ].join("\n"));
}

export function lockfileHasPackageResolution(
  lockfile: string,
  packageName: PiRuntimePackage,
  version: string,
): boolean {
  return lockfile.includes(`  '${packageName}@${version}':\n    resolution: {integrity: sha512-`);
}

export function lockfileHasPackageSnapshot(
  lockfile: string,
  packageName: PiRuntimePackage,
  version: string,
): boolean {
  return lockfile.includes(`  '${packageName}@${version}(`);
}

export function readInstalledPackage(packageName: PiRuntimePackage): PackageJson {
  const resolvedPath = fileURLToPath(import.meta.resolve(packageName));
  const marker = `/node_modules/${packageName}/`;
  const markerIndex = resolvedPath.lastIndexOf(marker);
  if (markerIndex < 0) {
    throw new Error(`Could not locate package root for ${packageName}: ${resolvedPath}`);
  }
  const packageRoot = resolvedPath.slice(0, markerIndex + marker.length - 1);
  return readJsonFile(join(packageRoot, "package.json"));
}
