import { describe, expect, it } from "vitest";
import { normalizeCommandValue } from "@main/connector-helpers";

describe("command path normalization", () => {
  it("trims surrounding whitespace from command values", () => {
    expect(normalizeCommandValue("  claude  ")).toBe("claude");
    expect(normalizeCommandValue("\tcodex\n")).toBe("codex");
  });

  it("keeps bare commands unchanged", () => {
    expect(normalizeCommandValue("claude")).toBe("claude");
    expect(normalizeCommandValue("codex")).toBe("codex");
  });

  it("normalizes null and undefined to empty string", () => {
    expect(normalizeCommandValue(null)).toBe("");
    expect(normalizeCommandValue(undefined)).toBe("");
  });
});
