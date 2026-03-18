import { describe, expect, it } from "vitest";
import { parseKimiStdoutLine } from "../src/ui/parse-stdout.js";

describe("parseKimiStdoutLine", () => {
  it("returns a stdout entry for non-empty lines", () => {
    const entries = parseKimiStdoutLine("hello", "2026-03-17T00:00:00.000Z");
    expect(entries).toEqual([
      { kind: "stdout", ts: "2026-03-17T00:00:00.000Z", text: "hello" },
    ]);
  });

  it("drops blank lines", () => {
    expect(parseKimiStdoutLine("   ", "2026-03-17T00:00:00.000Z")).toEqual([]);
  });
});
