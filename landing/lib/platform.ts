import { downloadAssets, type ReleaseDownloadAsset } from "./downloads";
import type { ReleaseArchitecture } from "./release-links";

export type DetectedOs = "macos" | "windows" | "linux" | "unknown";
export type DetectedArch = "arm64" | "x64" | "unknown";
export type DetectedPlatform = { os: DetectedOs; arch: DetectedArch };

export type UaData = { platform?: string; architecture?: string; bitness?: string };

type NavigatorUaData = UaData & {
  getHighEntropyValues(hints: string[]): Promise<UaData>;
};

function detectOs(userAgent: string, uaPlatform: string): DetectedOs {
  if (/android|iphone|ipad|ipod|cros/.test(userAgent)) return "unknown";
  if (uaPlatform === "macos" || /mac os x|macintosh/.test(userAgent)) return "macos";
  if (uaPlatform === "windows" || /windows/.test(userAgent)) return "windows";
  if (uaPlatform === "linux" || /linux|x11/.test(userAgent)) return "linux";
  return "unknown";
}

function detectArch(userAgent: string, uaArchitecture: string): DetectedArch {
  if (uaArchitecture === "arm") return "arm64";
  if (uaArchitecture === "x86") return "x64";
  if (/arm64|aarch64/.test(userAgent)) return "arm64";
  if (/x86_64|x64|win64|wow64|amd64/.test(userAgent)) return "x64";
  return "unknown";
}

export function detectPlatform(userAgent: string, uaData?: UaData): DetectedPlatform {
  const ua = userAgent.toLowerCase();
  const os = detectOs(ua, uaData?.platform?.toLowerCase() ?? "");
  // Mac user agents always say "Intel", so only client hints can tell the architecture apart.
  const arch = detectArch(os === "macos" ? "" : ua, uaData?.architecture?.toLowerCase() ?? "");
  return { os, arch };
}

export function recommendedAsset(
  platform: DetectedPlatform,
  assets: ReleaseDownloadAsset[] = downloadAssets,
): ReleaseDownloadAsset | null {
  if (platform.os === "unknown") return null;
  // Windows on ARM runs the x64 installer under emulation; a Mac of unknown architecture gets a choice.
  let arch: ReleaseArchitecture;
  if (platform.os === "windows") arch = "x64";
  else if (platform.arch !== "unknown") arch = platform.arch;
  else if (platform.os === "linux") arch = "x64";
  else return null;
  return assets.find((asset) => asset.platformId === platform.os && asset.architectures.includes(arch)) ?? null;
}

export async function detectClientPlatform(): Promise<DetectedPlatform> {
  const uaData = (navigator as Navigator & { userAgentData?: NavigatorUaData }).userAgentData;
  const hints = uaData ? await uaData.getHighEntropyValues(["architecture", "bitness"]) : undefined;
  return detectPlatform(navigator.userAgent, hints);
}
