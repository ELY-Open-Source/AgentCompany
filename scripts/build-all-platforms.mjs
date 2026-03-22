#!/usr/bin/env node
/**
 * build-all-platforms.mjs
 * Builds Electron app artifacts for the current platform and reports
 * which platforms still need native builds on their respective hosts.
 *
 * Usage: node scripts/build-all-platforms.mjs [--skip-vite]
 *
 * Per D-07: All three platforms (macOS, Windows, Linux) must produce
 * valid build artifacts.
 *
 * electron-builder does NOT support true cross-compilation for all targets:
 *   - macOS DMG/zip requires macOS
 *   - Windows NSIS/portable requires Windows (or Wine)
 *   - Linux AppImage requires Linux (or Docker)
 *
 * This script builds for the CURRENT platform, verifies artifacts, and
 * documents remaining platforms that must be built on their native hosts.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const releaseDir = join(rootDir, "build", "release");
const skipVite = process.argv.includes("--skip-vite");

const PLATFORM_FLAGS = {
  darwin: "--mac",
  win32: "--win",
  linux: "--linux",
};

const PLATFORM_NAMES = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

const EXPECTED_EXTENSIONS = {
  darwin: [".dmg", ".zip"],
  win32: [".exe"],
  linux: [".AppImage"],
};

const currentPlatform = process.platform;
const platformFlag = PLATFORM_FLAGS[currentPlatform];

if (!platformFlag) {
  console.error(`[build-all] Unsupported platform: ${currentPlatform}`);
  process.exit(1);
}

console.log(`[build-all] Building for ${PLATFORM_NAMES[currentPlatform]} (${currentPlatform})...`);

// Step 1: Run electron-vite build (unless --skip-vite)
if (!skipVite) {
  console.log("[build-all] Running electron-vite build...");
  execFileSync("pnpm", ["electron-vite", "build"], {
    stdio: "inherit",
    cwd: rootDir,
    shell: currentPlatform === "win32",
  });
}

// Step 2: Run build-desktop.mjs with the current platform flag
console.log(`[build-all] Running electron-builder ${platformFlag}...`);
execFileSync("node", [join(__dirname, "build-desktop.mjs"), platformFlag], {
  stdio: "inherit",
  cwd: rootDir,
  env: {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY ?? "false",
  },
  shell: currentPlatform === "win32",
});

// Step 3: Verify build artifacts exist
if (!existsSync(releaseDir)) {
  console.error(`[build-all] ERROR: Release directory not found: ${releaseDir}`);
  process.exit(1);
}

const files = await readdir(releaseDir);
const expectedExts = EXPECTED_EXTENSIONS[currentPlatform];
const foundArtifacts = files.filter((f) =>
  expectedExts.some((ext) => f.endsWith(ext)),
);

if (foundArtifacts.length === 0) {
  console.error(
    `[build-all] ERROR: No ${PLATFORM_NAMES[currentPlatform]} artifacts found in ${releaseDir}. ` +
    `Expected files with extensions: ${expectedExts.join(", ")}`,
  );
  process.exit(1);
}

console.log(`\n[build-all] SUCCESS: ${PLATFORM_NAMES[currentPlatform]} build artifacts:`);
for (const artifact of foundArtifacts) {
  console.log(`  - ${artifact}`);
}

// Step 4: Report remaining platforms
const otherPlatforms = Object.entries(PLATFORM_NAMES)
  .filter(([key]) => key !== currentPlatform)
  .map(([, name]) => name);

if (otherPlatforms.length > 0) {
  console.log(`\n[build-all] NOTE: Build on these platforms for full D-07 coverage:`);
  for (const name of otherPlatforms) {
    console.log(`  - ${name}: run 'pnpm build:all' on a ${name} host`);
  }
}

console.log("\n[build-all] Done.");
