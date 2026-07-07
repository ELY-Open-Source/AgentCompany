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

  test("the hardcoded key resolves in every build", () => {
    expect(composioApiKey()).toBe("***REMOVED***");
  });
});
