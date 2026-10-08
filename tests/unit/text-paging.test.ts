import { describe, expect, test } from "vitest";
import { pageText, readPageArgs } from "../../src/main/services/text-paging";

const numbered = (count: number, width = 10) => Array.from({ length: count }, (_, index) => `line ${index + 1} `.padEnd(width, "."));

describe("text paging", () => {
  test("a small file comes back unchanged", () => {
    expect(pageText("a.md", "one\ntwo", readPageArgs({}))).toBe("one\ntwo");
  });

  test("a large file pages by lines and says where to continue", () => {
    const content = numbered(5000).join("\n");
    const first = pageText("big.ts", content, readPageArgs({}));
    expect(first.startsWith("[lines 1-2181 of 5000 in big.ts]\nline 1 ")).toBe(true);
    expect(first.endsWith("[more: pass start_line=2182 to continue]")).toBe(true);
    const tail = pageText("big.ts", content, readPageArgs({ start_line: 4999 }));
    expect(tail).toBe("[lines 4999-5000 of 5000 in big.ts]\nline 4999 \nline 5000 ");
    const window = pageText("big.ts", content, readPageArgs({ start_line: 10, line_count: 2 }));
    expect(window).toBe("[lines 10-11 of 5000 in big.ts]\nline 10 ..\nline 11 ..\n[more: pass start_line=12 to continue]");
  });

  test("search returns numbered matching lines", () => {
    const content = ["alpha", "Beta release", "gamma", "beta test"].join("\n");
    expect(pageText("notes.md", content, readPageArgs({ search: "beta" }))).toBe('[2 matching lines for "beta" in notes.md]\n2: Beta release\n4: beta test');
    expect(pageText("notes.md", content, readPageArgs({ search: "delta" }))).toBe('No lines in notes.md contain "delta".');
  });

  test("an overlong single line is cut and the next line is offered", () => {
    const content = `${"x".repeat(30_000)}\nsecond`;
    const page = pageText("min.js", content, readPageArgs({}));
    expect(page).toContain("[line 1 continues: pass start_line=1 and start_column=24001]");
    expect(page.endsWith("[more: pass start_line=2 to continue]")).toBe(true);
    const rest = pageText("min.js", content, readPageArgs({ start_line: 1, start_column: 24_001 }));
    expect(rest).toBe(`[lines 1-2 of 2 in min.js]\n${"x".repeat(6_000)}\nsecond`);
  });

  test("a one-line file longer than the limit is still cut", () => {
    const page = pageText("blob.txt", "y".repeat(30_000), readPageArgs({}));
    expect(page.length).toBeLessThan(24_200);
    expect(page.startsWith("[lines 1-1 of 1 in blob.txt]")).toBe(true);
    expect(page).toContain("[line 1 continues: pass start_line=1 and start_column=24001]");
  });

  test("boundaries: an exact-limit line is whole, and search output stays under the cap", () => {
    const exact = "z".repeat(24_000);
    expect(pageText("exact.txt", exact, readPageArgs({}))).toBe(exact);
    const noisy = Array.from({ length: 300 }, (_, index) => `${index} needle ${"w".repeat(600)}`).join("\n");
    const found = pageText("noisy.txt", noisy, readPageArgs({ search: "needle" }));
    expect(found.length).toBeLessThan(24_200);
    expect(found).toMatch(/\[\d+ more matches not shown; narrow the search\]$/);
  });

  test("bad ranges fail loudly", () => {
    expect(() => readPageArgs({ start_line: 0 })).toThrow('"start_line" must be a positive whole number.');
    expect(() => readPageArgs({ line_count: 2.5 })).toThrow('"line_count" must be a positive whole number.');
    expect(() => pageText("a.md", "one", readPageArgs({ start_line: 3 }))).toThrow("a.md has only 1 lines.");
  });
});
