export type PlatformDownloadAsset = {
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

export const releaseVersion = "0.4.164";

export const platformDownloads: PlatformDownload[] = [
  {
    id: "macos",
    title: "macOS",
    note: "Signed + notarized DMG builds",
    assets: [
      {
        id: "macos-arm64-dmg",
        label: "Apple Silicon DMG",
        href: "https://pub-a19a3a2c1d2e4fa3a9c120b184024448.r2.dev/AC/AgentCompany-0.4.164-arm64.dmg",
        note: "arm64",
      },
      {
        id: "macos-x64-dmg",
        label: "Intel Mac DMG",
        href: "https://pub-a19a3a2c1d2e4fa3a9c120b184024448.r2.dev/AC/AgentCompany-0.4.164.dmg",
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
        href: "https://pub-a19a3a2c1d2e4fa3a9c120b184024448.r2.dev/AC/AgentCompany.Setup.0.4.164.exe",
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
        href: "https://pub-a19a3a2c1d2e4fa3a9c120b184024448.r2.dev/AC/AgentCompany-0.4.164.AppImage",
        note: "x64",
      },
      {
        id: "linux-x64-deb",
        label: "Linux x64 DEB",
        href: "https://pub-a19a3a2c1d2e4fa3a9c120b184024448.r2.dev/AC/agent-company_0.4.164_amd64.deb",
        note: "x64",
      },
      {
        id: "linux-x64-rpm",
        label: "Linux x64 RPM",
        href: "https://pub-a19a3a2c1d2e4fa3a9c120b184024448.r2.dev/AC/agent-company-0.4.164.x86_64.rpm",
        note: "x64",
      },
      {
        id: "linux-arm64-appimage",
        label: "Linux ARM64 AppImage",
        href: "https://pub-a19a3a2c1d2e4fa3a9c120b184024448.r2.dev/AC/AgentCompany-0.4.164-arm64.AppImage",
        note: "arm64",
      },
      {
        id: "linux-arm64-deb",
        label: "Linux ARM64 DEB",
        href: "https://pub-a19a3a2c1d2e4fa3a9c120b184024448.r2.dev/AC/agent-company_0.4.164_arm64.deb",
        note: "arm64",
      },
      {
        id: "linux-arm64-rpm",
        label: "Linux ARM64 RPM",
        href: "https://pub-a19a3a2c1d2e4fa3a9c120b184024448.r2.dev/AC/agent-company-0.4.164.aarch64.rpm",
        note: "arm64",
      },
    ],
  },
];
