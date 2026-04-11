import { describe, expect, it } from "vitest";
import { buildWindowsSpawnTarget, normalizeCommandValue } from "@agentcompany/adapter-utils/server-utils";
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

  it("spawns direct exe paths on Windows instead of wrapping them through cmd.exe", () => {
    const target = buildWindowsSpawnTarget(
      "C:\\Users\\First Last\\AppData\\Local\\bin\\claude.exe",
      ["--version"],
      "cmd.exe",
    );
    expect(target).toEqual({
      command: "C:\\Users\\First Last\\AppData\\Local\\bin\\claude.exe",
      args: ["--version"],
    });
  });

  it("still wraps shell scripts through cmd.exe on Windows", () => {
    const target = buildWindowsSpawnTarget(
      "C:\\Tools\\agentcompany\\launch.cmd",
      ["--version"],
      "cmd.exe",
    );
    expect(target.command).toBe("cmd.exe");
    expect(target.args[0]).toBe("/d");
    expect(target.args.at(-1)).toContain("launch.cmd");
  });
});
