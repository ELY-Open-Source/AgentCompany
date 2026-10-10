import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DOWNLOAD_DEDUP_WINDOW_MS,
  downloadAssets,
  getDownloadAsset,
  getTrackedDownloadHref,
  isAllowedDownloadUrl,
} from "../../lib/downloads";
import { releaseVersion } from "../../lib/release-links";

test("lists every v1.5.1 build with unique ids", () => {
  assert.deepEqual(
    downloadAssets.map((asset) => asset.id),
    [
      "macos-arm64-dmg",
      "macos-arm64-zip",
      "macos-x64-dmg",
      "macos-x64-zip",
      "windows-x64-installer",
      "linux-x64-appimage",
      "linux-x64-deb",
    ],
  );
});

test("points every asset at the Gitea release for the current version", () => {
  for (const asset of downloadAssets) {
    assert.ok(isAllowedDownloadUrl(asset.href), asset.href);
    assert.ok(asset.href.endsWith(`/releases/download/v${releaseVersion}/${asset.fileName}`), asset.href);
    assert.match(asset.size, /^\d+ MB$/);
  }
});

test("looks assets up by id and tracks downloads through the API", () => {
  assert.equal(getDownloadAsset("linux-x64-deb")?.platformId, "linux");
  assert.equal(getDownloadAsset("missing"), null);
  assert.equal(getTrackedDownloadHref("macos-arm64-dmg"), "/api/download?asset=macos-arm64-dmg");
  assert.equal(getTrackedDownloadHref("a b&c"), "/api/download?asset=a%20b%26c");
  assert.equal(DOWNLOAD_DEDUP_WINDOW_MS, 86_400_000);
});

test("rejects download urls off the release host", () => {
  assert.equal(isAllowedDownloadUrl("https://evil.example/AgentCompany.dmg"), false);
  assert.equal(isAllowedDownloadUrl("http://git.zacharyzhang.com/x.dmg"), false);
  assert.equal(isAllowedDownloadUrl("https://git.zacharyzhang.com.evil.example/x.dmg"), false);
});
