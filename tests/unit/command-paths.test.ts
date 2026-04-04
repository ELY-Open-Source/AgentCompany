import { describe, expect, it } from "vitest";
import { normalizeCommandValue } from "@agentcompany/adapter-utils/server-utils";
import { commandLooksLike } from "@agentcompany/adapter-utils/test-utils";

describe("command path normalization", () => {
  it("removes surrounding quotes from absolute executable paths", () => {
    expect(normalizeCommandValue('"C:\\Users\\First Last\\AppData\\Local\\bin\\claude.exe"')).toBe(
      "C:\\Users\\First Last\\AppData\\Local\\bin\\claude.exe",
    );
    expect(normalizeCommandValue("'C:\\Users\\First Last\\AppData\\Local\\bin\\claude.exe'")).toBe(
      "C:\\Users\\First Last\\AppData\\Local\\bin\\claude.exe",
    );
  });

  it("keeps bare commands unchanged", () => {
    expect(normalizeCommandValue("claude")).toBe("claude");
    expect(normalizeCommandValue("codex")).toBe("codex");
  });

  it("matches quoted commands against connector executables", () => {
    expect(commandLooksLike('"C:\\Users\\First Last\\AppData\\Local\\bin\\claude.exe"', "claude")).toBe(true);
    expect(commandLooksLike("'C:\\Users\\First Last\\AppData\\Local\\bin\\codex.exe'", "codex")).toBe(true);
  });
});
