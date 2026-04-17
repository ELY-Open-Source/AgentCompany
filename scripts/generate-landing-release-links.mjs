import { readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "./release/lib/dotenv.mjs";

const rootDir = process.cwd();
const localReleaseDir = join(rootDir, "local-release");
const outputPath = join(rootDir, "landing", "components", "release-links.generated.ts");

function normalizeBaseUrl(url) {
  return url.replace(/\/+$/, "");
}

function normalizePathSegment(pathValue) {
  return pathValue.replace(/^\/+|\/+$/g, "");
}

function resolveUpdateBaseUrl() {
  const explicit = process.env.AGENTCOMPANY_UPDATE_URL?.trim();
  if (explicit) return normalizeBaseUrl(explicit);

  const publicBaseUrl =
    process.env.AGENTCOMPANY_R2_PUBLIC_URL?.trim() ||
    process.env.R2_PUBLIC_BASE_URL?.trim();
  const prefix = process.env.AGENTCOMPANY_RELEASE_PREFIX?.trim() || "AC";

  if (!publicBaseUrl) {
    throw new Error("Missing AGENTCOMPANY_UPDATE_URL / R2 public URL while generating landing release links.");
  }

  const normalizedBase = normalizeBaseUrl(publicBaseUrl);
  const normalizedPrefix = normalizePathSegment(prefix);
  return `${normalizedBase}/${normalizedPrefix}`;
}

function ensureSingle(files, predicate, label) {
  const matches = files.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${label} artifact, found ${matches.length}: ${matches.join(", ")}`);
  }
  return matches[0];
}

function extractVersion(fileNames) {
  const versions = new Set(
    fileNames
      .map((fileName) => fileName.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null)
      .filter(Boolean),
  );

  if (versions.size !== 1) {
    throw new Error(`Expected exactly one release version across artifacts, found: ${[...versions].join(", ")}`);
  }

  return [...versions][0];
}

function urlFor(baseUrl, fileName) {
  return `${baseUrl}/${encodeURIComponent(fileName)}`;
}

async function main() {
  await loadEnvFile(join(rootDir, ".env.release.local"));
  await loadEnvFile(join(rootDir, ".env.release"));

  if (!existsSync(localReleaseDir)) {
    throw new Error(`Local release directory not found: ${localReleaseDir}`);
  }

  const baseUrl = resolveUpdateBaseUrl();
  const macFiles = (await readdir(join(localReleaseDir, "mac"))).filter((name) => !name.startsWith("."));
  const winFiles = (await readdir(join(localReleaseDir, "win"))).filter((name) => !name.startsWith("."));
  const linuxFiles = (await readdir(join(localReleaseDir, "linux"))).filter((name) => !name.startsWith("."));

  const macArm64Dmg = ensureSingle(macFiles, (name) => name.endsWith(".dmg") && name.includes("arm64"), "macOS Apple Silicon .dmg");
  const macIntelDmg = ensureSingle(macFiles, (name) => name.endsWith(".dmg") && !name.includes("arm64"), "macOS Intel .dmg");
  const windowsUniversalInstaller = ensureSingle(
    winFiles,
    (name) => name.endsWith(".exe") && name.includes("Setup"),
    "Windows universal installer",
  );
  const linuxX64AppImage = ensureSingle(
    linuxFiles,
    (name) => name.endsWith(".AppImage") && !name.includes("arm64"),
    "Linux x64 AppImage",
  );
  const linuxArm64AppImage = ensureSingle(
    linuxFiles,
    (name) => name.endsWith(".AppImage") && name.includes("arm64"),
    "Linux arm64 AppImage",
  );
  const linuxX64Deb = ensureSingle(
    linuxFiles,
    (name) => name.endsWith(".deb") && name.includes("amd64"),
    "Linux x64 .deb",
  );
  const linuxArm64Deb = ensureSingle(
    linuxFiles,
    (name) => name.endsWith(".deb") && name.includes("arm64"),
    "Linux arm64 .deb",
  );
  const linuxX64Rpm = ensureSingle(
    linuxFiles,
    (name) => name.endsWith(".rpm") && (name.includes("x86_64") || name.includes("amd64")),
    "Linux x64 .rpm",
  );
  const linuxArm64Rpm = ensureSingle(
    linuxFiles,
    (name) => name.endsWith(".rpm") && (name.includes("aarch64") || name.includes("arm64")),
    "Linux arm64 .rpm",
  );

  const version = extractVersion([
    macArm64Dmg,
    macIntelDmg,
    windowsUniversalInstaller,
    linuxX64AppImage,
    linuxArm64AppImage,
    linuxX64Deb,
    linuxArm64Deb,
    linuxX64Rpm,
    linuxArm64Rpm,
  ]);

  const content = `export type PlatformDownloadAsset = {
  id: string;
  label: string;
  href: string;
  note: string;
};

export type PlatformDownload = {
  id: "macos" | "windows" | "linux";
  title: string;
  note: string;
  assets: PlatformDownloadAsset[];
};

export const releaseVersion = "${version}";

export const platformDownloads: PlatformDownload[] = [
  {
    id: "macos",
    title: "macOS",
    note: "Signed + notarized DMG builds",
    assets: [
      {
        id: "macos-arm64-dmg",
        label: "Apple Silicon DMG",
        href: "${urlFor(baseUrl, macArm64Dmg)}",
        note: "arm64",
      },
      {
        id: "macos-x64-dmg",
        label: "Intel Mac DMG",
        href: "${urlFor(baseUrl, macIntelDmg)}",
        note: "x64",
      },
    ],
  },
  {
    id: "windows",
    title: "Windows",
    note: "NSIS installer builds",
    assets: [
      {
        id: "windows-universal-installer",
        label: "Windows Universal Installer",
        href: "${urlFor(baseUrl, windowsUniversalInstaller)}",
        note: "arm64 + x64 + ia32",
      },
    ],
  },
  {
    id: "linux",
    title: "Linux",
    note: "AppImage, DEB, and RPM builds",
    assets: [
      {
        id: "linux-x64-appimage",
        label: "Linux x64 AppImage",
        href: "${urlFor(baseUrl, linuxX64AppImage)}",
        note: "x64",
      },
      {
        id: "linux-x64-deb",
        label: "Linux x64 DEB",
        href: "${urlFor(baseUrl, linuxX64Deb)}",
        note: "x64",
      },
      {
        id: "linux-x64-rpm",
        label: "Linux x64 RPM",
        href: "${urlFor(baseUrl, linuxX64Rpm)}",
        note: "x64",
      },
      {
        id: "linux-arm64-appimage",
        label: "Linux ARM64 AppImage",
        href: "${urlFor(baseUrl, linuxArm64AppImage)}",
        note: "arm64",
      },
      {
        id: "linux-arm64-deb",
        label: "Linux ARM64 DEB",
        href: "${urlFor(baseUrl, linuxArm64Deb)}",
        note: "arm64",
      },
      {
        id: "linux-arm64-rpm",
        label: "Linux ARM64 RPM",
        href: "${urlFor(baseUrl, linuxArm64Rpm)}",
        note: "arm64",
      },
    ],
  },
];
`;

  await writeFile(outputPath, content, "utf8");
  console.log(`[generate-landing-release-links] wrote ${outputPath}`);
  console.log(`[generate-landing-release-links] version ${version}`);
}

await main();
