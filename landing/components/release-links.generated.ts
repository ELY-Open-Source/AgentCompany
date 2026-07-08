export type PlatformDownloadAsset = {
  architectures: ReleaseArchitecture[];
  id: string;
  label: string;
  href: string;
  note: string;
};

export type ReleaseArchitecture = "arm64" | "x64" | "x86";

export type PlatformDownload = {
  id: "macos" | "windows" | "linux";
  packageDescription: string;
  title: string;
  note: string;
  assets: PlatformDownloadAsset[];
};

export const releaseVersion = "1.0.0";

export const platformDownloads: PlatformDownload[] = [
  {
    id: "macos",
    packageDescription: "signed and notarized DMG builds",
    title: "macOS",
    note: "Signed + notarized DMG builds",
    assets: [
      {
        architectures: ["arm64"],
        id: "macos-arm64-dmg",
        label: "Apple Silicon DMG",
        href: "https://pub-a19a3a2c1d2e4fa3a9c120b184024448.r2.dev/AC/AgentCompany-1.0.0-arm64.dmg",
        note: "arm64",
      },
      {
        architectures: ["x64"],
        id: "macos-x64-dmg",
        label: "Intel Mac DMG",
        href: "https://pub-a19a3a2c1d2e4fa3a9c120b184024448.r2.dev/AC/AgentCompany-1.0.0.dmg",
        note: "x64",
      },
    ],
  },
  {
    id: "windows",
    packageDescription: "an NSIS installer build",
    title: "Windows",
    note: "NSIS installer builds",
    assets: [
      {
        architectures: ["arm64", "x64"],
        id: "windows-universal-installer",
        label: "Windows Universal Installer",
        href: "https://pub-a19a3a2c1d2e4fa3a9c120b184024448.r2.dev/AC/AgentCompany.Setup.0.4.182.exe",
        note: "arm64 + x64",
      },
    ],
  },
];
