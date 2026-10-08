import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import { BoundedOutput, runCommand } from "../../src/main/services/workspace-command";

describe("bounded command output", () => {
  test("holds at most head and tail while counting what it drops", () => {
    const output = new BoundedOutput();
    output.push(Buffer.from("START-"));
    output.push(Buffer.alloc(10_000_000, 120));
    expect(output.retainedBytes()).toBeLessThanOrEqual(16_000);
    for (let index = 0; index < 1_000; index += 1) output.push(Buffer.alloc(10_000, 120));
    expect(output.retainedBytes()).toBeLessThanOrEqual(16_000);
    output.push(Buffer.from("-END"));
    const text = output.text();
    expect(text.startsWith("START-x")).toBe(true);
    expect(text.endsWith("x-END")).toBe(true);
    expect(text).toContain(`[... ${6 + 20_000_000 + 4 - 16_000} bytes of output dropped ...]`);
  });

  test("output that fits decodes as one piece, even across the head boundary", () => {
    const output = new BoundedOutput();
    output.push(Buffer.from(`${"a".repeat(7_999)}邮END`, "utf8"));
    expect(output.text()).toBe(`${"a".repeat(7_999)}邮END`);
  });

  test("small output comes back whole", () => {
    const output = new BoundedOutput();
    output.push(Buffer.from("hello "));
    output.push(Buffer.from("world"));
    expect(output.text()).toBe("hello world");
  });

  test("a command printing megabytes returns its start, end, and the dropped count", async () => {
    const result = await runCommand(tmpdir(), "node -e \"process.stdout.write('BEGIN' + 'a'.repeat(5000000) + 'FINISH')\"");
    expect(result.startsWith("exit code 0\nBEGINaaa")).toBe(true);
    expect(result.endsWith("aaaFINISH")).toBe(true);
    expect(result).toContain("bytes of output dropped");
    expect(result.length).toBeLessThan(16_200);
  });
});
