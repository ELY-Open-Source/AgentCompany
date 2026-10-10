export type ReleaseArchitecture = "arm64" | "x64";

export type PlatformDownloadAsset = {
  architectures: ReleaseArchitecture[];
  id: string;
  label: string;
  fileName: string;
  href: string;
  sizeBytes: number;
  size: string;
  note: string;
};

export type PlatformDownload = {
  id: "macos" | "windows" | "linux";
  packageDescription: string;
  title: string;
  note: string;
  assets: PlatformDownloadAsset[];
};

export const releaseVersion = "1.5.1";
export const RELEASE_HOST = "git.zacharyzhang.com";
export const SOURCE_URL = `https://${RELEASE_HOST}/ZacharyZhang-NY/AgentCompany`;
export const RELEASE_PAGE_URL = `${SOURCE_URL}/releases/tag/v${releaseVersion}`;

function asset(
  id: string,
  label: string,
  architecture: ReleaseArchitecture,
  fileName: string,
  sizeBytes: number,
): PlatformDownloadAsset {
  return {
    architectures: [architecture],
    id,
    label,
    fileName,
    href: `${SOURCE_URL}/releases/download/v${releaseVersion}/${fileName}`,
    sizeBytes,
    size: `${Math.round(sizeBytes / 1_000_000)} MB`,
    note: `${architecture} · v${releaseVersion}`,
  };
}

export const platformDownloads: PlatformDownload[] = [
  {
    id: "macos",
    packageDescription: "signed and notarized DMG and ZIP builds",
    title: "macOS",
    note: "Signed + notarized DMG and ZIP builds",
    assets: [
      asset("macos-arm64-dmg", "Apple Silicon DMG", "arm64", "AgentCompany-1.5.1-arm64.dmg", 118584099),
      asset("macos-arm64-zip", "Apple Silicon ZIP", "arm64", "AgentCompany-1.5.1-arm64-mac.zip", 321953469),
      asset("macos-x64-dmg", "Intel Mac DMG", "x64", "AgentCompany-1.5.1.dmg", 126949692),
      asset("macos-x64-zip", "Intel Mac ZIP", "x64", "AgentCompany-1.5.1-mac.zip", 346581782),
    ],
  },
  {
    id: "windows",
    packageDescription: "an NSIS installer build",
    title: "Windows",
    note: "NSIS installer build",
    assets: [
      asset("windows-x64-installer", "Windows Installer (x64)", "x64", "AgentCompany-1.5.1-x64.exe", 98672653),
    ],
  },
  {
    id: "linux",
    packageDescription: "AppImage and .deb builds",
    title: "Linux",
    note: "AppImage and .deb builds",
    assets: [
      asset("linux-x64-appimage", "Linux AppImage (x64)", "x64", "AgentCompany-1.5.1.AppImage", 122224922),
      asset("linux-x64-deb", "Debian/Ubuntu .deb (x64)", "x64", "agentcompany-new_1.5.1_amd64.deb", 95501700),
    ],
  },
];
