import { describe, expect, test } from "vitest";
import { composioApiKey, normalizeComposioApiKey } from "../../src/main/services/composio/composio-credentials";

describe("composio credential resolution", () => {
  test("trims the embedded key", () => {
    expect(normalizeComposioApiKey(" ak_live ")).toBe("ak_live");
  });

  test("a blank key resolves to null so callers report the integration as unconfigured", () => {
    expect(normalizeComposioApiKey("")).toBeNull();
    expect(normalizeComposioApiKey("   ")).toBeNull();
  });

  test("without the build-time injection the key is null", () => {
    // Vitest runs without the electron-vite define — the same shape as a
    // build from a checkout that has no cred.txt.
    expect(composioApiKey()).toBeNull();
  });
});
