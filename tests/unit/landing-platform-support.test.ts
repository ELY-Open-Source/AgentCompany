import { describe, expect, it } from "vitest";
import { platformDownloads, type PlatformDownload } from "../../landing/components/release-links.generated";
import { buildPlatformSupportSummary } from "../../landing/lib/platform-support";

describe("landing platform support copy", () => {
  it("derives FAQ support copy from current generated release assets", () => {
    const summary = buildPlatformSupportSummary(platformDownloads);

    expect(summary.downloadAnswer).toBe(
        "Use the download section on this page to choose the build that matches your architecture and package format. " +
        "macOS ships as signed and notarized DMG builds for arm64 and x64. " +
        "Windows ships as an NSIS installer build for arm64 and x64. " +
        "Linux ships as AppImage, DEB, and RPM builds for arm64 and x64.",
    );
    expect(summary.platformAnswer).toBe(
      "AgentCompany is available on macOS (arm64, x64), Windows (arm64, x64), " +
        "and Linux (arm64, x64). It is built with Electron and the desktop feature set stays aligned across all supported targets.",
    );
  });

  it("uses structured architectures and platform package notes", () => {
    const downloads = [
      platform("macos", "macOS", "PKG builds", "PKG Builds", [["Apple Silicon", ["arm64"], "display-only note"]]),
      platform("windows", "Windows", "an MSIX build", "MSIX Builds", [["Universal", ["arm64", "x64"], "ARM64 + x64"]]),
      platform("linux", "Linux", "tarball builds", "Tarball Builds", [["Linux bundle", ["x64"], "x64 (glibc)"]]),
    ];

    const summary = buildPlatformSupportSummary(downloads);

    expect(summary.downloadAnswer).toBe(
      "Use the download section on this page to choose the build that matches your architecture and package format. " +
        "macOS ships as PKG builds for arm64. " +
        "Windows ships as an MSIX build for arm64 and x64. " +
        "Linux ships as tarball builds for x64.",
    );
    expect(summary.platformAnswer).toBe(
      "AgentCompany is available on macOS (arm64), Windows (arm64, x64), and Linux (x64). " +
        "It is built with Electron and the desktop feature set stays aligned across all supported targets.",
    );
  });

  it("keeps generated asset notes synchronized with structured architectures", () => {
    for (const platformDownload of platformDownloads) {
      for (const asset of platformDownload.assets) {
        expect(asset.note).toBe(asset.architectures.join(" + "));
      }
    }
  });

  it("fails when generated release assets omit architecture metadata", () => {
    const downloads = [
      platform("macos", "macOS", "DMG builds", "DMG Builds", [["Apple Silicon", [], "arm64"]]),
      platform("windows", "Windows", "an NSIS installer build", "NSIS Builds", [["Universal", ["arm64", "x64"], "arm64 + x64"]]),
      platform("linux", "Linux", "AppImage builds", "AppImage Builds", [["Linux", ["x64"], "x64"]]),
    ];

    expect(() => buildPlatformSupportSummary(downloads)).toThrow(
      "Release asset macos/macos-apple-silicon must declare at least one architecture.",
    );
  });
});

function platform(
  id: PlatformDownload["id"],
  title: string,
  packageDescription: string,
  note: string,
  assets: Array<[label: string, architectures: PlatformDownload["assets"][number]["architectures"], note: string]>,
): PlatformDownload {
  return {
    id,
    packageDescription,
    title,
    note,
    assets: assets.map(([label, architectures, assetNote]) => ({
      architectures,
      id: `${id}-${label.toLowerCase().replaceAll(/\s+/g, "-")}`,
      label,
      href: `https://download.example/${id}`,
      note: assetNote,
    })),
  };
}
