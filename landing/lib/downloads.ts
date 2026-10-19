import { platformDownloads, RELEASE_DOWNLOAD_PREFIX, RELEASE_HOST, type PlatformDownload, type PlatformDownloadAsset } from "./release-links";

export const DOWNLOAD_COUNT_SEED = 13674;
export const DOWNLOAD_DEDUP_WINDOW_HOURS = 24;
export const DOWNLOAD_DEDUP_WINDOW_MS = DOWNLOAD_DEDUP_WINDOW_HOURS * 60 * 60 * 1000;

export type ReleaseDownloadAsset = PlatformDownloadAsset & {
  platformId: PlatformDownload["id"];
  platformTitle: string;
};

export const downloadAssets: ReleaseDownloadAsset[] = platformDownloads.flatMap((platform) =>
  platform.assets.map((asset) => ({
    ...asset,
    platformId: platform.id,
    platformTitle: platform.title,
  })),
);

const downloadAssetMap = new Map(downloadAssets.map((asset) => [asset.id, asset]));

export function getDownloadAsset(assetId: string) {
  return downloadAssetMap.get(assetId) ?? null;
}

export function getTrackedDownloadHref(assetId: string) {
  return `/api/download?asset=${encodeURIComponent(assetId)}`;
}

export function isAllowedDownloadUrl(href: string) {
  const url = new URL(href);
  return url.protocol === "https:" && url.host === RELEASE_HOST && url.pathname.startsWith(RELEASE_DOWNLOAD_PREFIX);
}
