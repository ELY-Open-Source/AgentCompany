import { describe, expect, test } from "vitest";
import { normalizeExternalBrowserUrl } from "../../src/main/app/external-url";

describe("external browser URL validation", () => {
  test("normalizes HTTPS URLs and preserves query strings", () => {
    expect(normalizeExternalBrowserUrl("https://example.com/docs?q=agent")).toBe("https://example.com/docs?q=agent");
  });

  test("rejects non-HTTPS and credential-bearing URLs", () => {
    expect(() => normalizeExternalBrowserUrl("http://example.com")).toThrow("External URLs must use HTTPS.");
    expect(() => normalizeExternalBrowserUrl("mailto:security@example.com")).toThrow("External URLs must use HTTPS.");
    expect(() => normalizeExternalBrowserUrl("https://user:token@example.com")).toThrow("External URLs must not include credentials.");
  });
});
