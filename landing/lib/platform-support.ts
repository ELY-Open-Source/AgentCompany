import {
  platformDownloads,
  type PlatformDownload,
  type PlatformDownloadAsset,
  type ReleaseArchitecture,
} from "../components/release-links.generated";

const ARCHITECTURE_ORDER: ReleaseArchitecture[] = ["arm64", "x64", "x86"];

export type PlatformSupportSummary = {
  downloadAnswer: string;
  platformAnswer: string;
};

export const platformSupportSummary = buildPlatformSupportSummary(platformDownloads);

export function buildPlatformSupportSummary(downloads: PlatformDownload[]): PlatformSupportSummary {
  const macos = requirePlatform(downloads, "macos");
  const windows = requirePlatform(downloads, "windows");

  return {
    downloadAnswer:
      `Use the download section on this page to choose the build that matches your architecture and package format. ` +
      `${formatDownloadSentence(macos)} ${formatDownloadSentence(windows)}`,
    platformAnswer:
      `AgentCompany is available on ${formatAvailability(macos)} and ${formatAvailability(windows)}. ` +
      `It is built with Electron and the desktop feature set stays aligned across all supported targets.`,
  };
}

function requirePlatform(downloads: PlatformDownload[], id: PlatformDownload["id"]): PlatformDownload {
  const platform = downloads.find((download) => download.id === id);
  if (!platform) {
    throw new Error(`Missing ${id} release download metadata.`);
  }
  return platform;
}

function formatDownloadSentence(download: PlatformDownload): string {
  const architectures = formatArchitectureList(collectArchitectures(download));

  if (!download.packageDescription.trim()) {
    throw new Error(`Release platform ${download.id} must include package format copy.`);
  }

  return `${download.title} ships as ${download.packageDescription} for ${architectures}.`;
}

function formatAvailability(download: PlatformDownload): string {
  return `${download.title} (${formatArchitectureList(collectArchitectures(download), "comma")})`;
}

function collectArchitectures(download: PlatformDownload): ReleaseArchitecture[] {
  const architectures = new Set<ReleaseArchitecture>();

  for (const asset of download.assets) {
    collectAssetArchitectures(download.id, asset).forEach((architecture) => architectures.add(architecture));
  }

  return [...architectures].sort((left, right) => architectureRank(left) - architectureRank(right));
}

function collectAssetArchitectures(
  platformId: PlatformDownload["id"],
  asset: PlatformDownloadAsset,
): ReleaseArchitecture[] {
  if (asset.architectures.length === 0) {
    throw new Error(`Release asset ${platformId}/${asset.id} must declare at least one architecture.`);
  }

  for (const architecture of asset.architectures) {
    if (!isReleaseArchitecture(architecture)) {
      throw new Error(`Release asset ${platformId}/${asset.id} declares unsupported architecture: ${architecture}`);
    }
  }

  return asset.architectures;
}

function isReleaseArchitecture(value: string): value is ReleaseArchitecture {
  return ARCHITECTURE_ORDER.includes(value as ReleaseArchitecture);
}

function architectureRank(architecture: ReleaseArchitecture): number {
  return ARCHITECTURE_ORDER.indexOf(architecture);
}

function formatArchitectureList(
  architectures: ReleaseArchitecture[],
  style: "and" | "comma" = "and",
): string {
  if (architectures.length === 0) {
    throw new Error("Release download metadata must include at least one architecture.");
  }
  if (style === "comma") {
    return architectures.join(", ");
  }
  if (architectures.length === 1) {
    return architectures[0];
  }
  if (architectures.length === 2) {
    return `${architectures[0]} and ${architectures[1]}`;
  }
  return `${architectures.slice(0, -1).join(", ")}, and ${architectures.at(-1)}`;
}
