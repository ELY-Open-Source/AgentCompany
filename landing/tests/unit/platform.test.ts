import assert from "node:assert/strict";
import { test } from "node:test";
import { detectPlatform, recommendedAsset } from "../../lib/platform";

const UA = {
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
  linuxArm: "Mozilla/5.0 (X11; Linux aarch64; rv:131.0) Gecko/20100101 Firefox/131.0",
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
};

test("detects desktop operating systems and architectures from the user agent", () => {
  assert.deepEqual(detectPlatform(UA.windows), { os: "windows", arch: "x64" });
  assert.deepEqual(detectPlatform(UA.linux), { os: "linux", arch: "x64" });
  assert.deepEqual(detectPlatform(UA.linuxArm), { os: "linux", arch: "arm64" });
});

test("treats the Mac user agent's Intel claim as unknown and trusts client hints", () => {
  assert.deepEqual(detectPlatform(UA.mac), { os: "macos", arch: "unknown" });
  assert.deepEqual(detectPlatform(UA.mac, { platform: "macOS", architecture: "arm" }), { os: "macos", arch: "arm64" });
  assert.deepEqual(detectPlatform(UA.mac, { platform: "macOS", architecture: "x86" }), { os: "macos", arch: "x64" });
});

test("reports phones as unknown even though their user agents mention Linux or Mac OS X", () => {
  assert.equal(detectPlatform(UA.android).os, "unknown");
  assert.equal(detectPlatform(UA.iphone).os, "unknown");
});

test("recommends the matching installer for each platform", () => {
  assert.equal(recommendedAsset({ os: "macos", arch: "arm64" })?.id, "macos-arm64-dmg");
  assert.equal(recommendedAsset({ os: "macos", arch: "unknown" }), null);
  assert.equal(recommendedAsset({ os: "macos", arch: "x64" })?.id, "macos-x64-dmg");
  assert.equal(recommendedAsset({ os: "windows", arch: "x64" })?.id, "windows-x64-installer");
  assert.equal(recommendedAsset({ os: "windows", arch: "arm64" })?.id, "windows-x64-installer");
  assert.equal(recommendedAsset({ os: "linux", arch: "x64" })?.id, "linux-x64-appimage");
  assert.equal(recommendedAsset({ os: "linux", arch: "unknown" })?.id, "linux-x64-appimage");
});

test("recommends nothing where no build exists", () => {
  assert.equal(recommendedAsset({ os: "linux", arch: "arm64" }), null);
  assert.equal(recommendedAsset({ os: "unknown", arch: "x64" }), null);
});
