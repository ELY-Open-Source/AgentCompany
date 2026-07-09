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

export const releaseVersion = "1.1.0";

// macOS is intentionally absent: its builds were never uploaded to R2, so
// every DMG link 404'd. Re-add the entry (and the footer links) only after
// the mac machine actually ships AC/AgentCompany-<version>-*.dmg.
export const platformDownloads: PlatformDownload[] = [
  {
    id: "windows",
    packageDescription: "a signed NSIS installer build",
    title: "Windows",
    note: "Signed NSIS installer build",
    assets: [
      {
        architectures: ["x64"],
        id: "windows-x64-installer",
        label: "Windows Installer (x64)",
        href: "https://pub-a19a3a2c1d2e4fa3a9c120b184024448.r2.dev/AC/AgentCompany-1.1.0-x64.exe",
        note: "x64 · v1.1.0",
      },
    ],
  },
];
