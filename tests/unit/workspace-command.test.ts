import { mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { BoundedOutput, formatCommandResult, runCommand } from "../../src/main/services/workspace-command";
import { stopRun, withRunControl } from "../../src/main/services/run-control";

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

  test("a timeout kills the whole process tree, including children that hold the output pipes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ac-tree-"));
    const pidFile = join(dir, "grandchild.pid").replaceAll("\\", "/");
    const script = `const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});require('fs').writeFileSync('${pidFile}',String(c.pid));setInterval(()=>{},1000)`;
    const started = Date.now();
    const result = await runCommand(dir, `node -e "${script}"`, { timeoutMs: 1_500 });
    expect(result).toMatch(/^ERROR: command timed out after 1\.5s and was killed/);
    expect(Date.now() - started).toBeLessThan(10_000);
    const grandchild = Number(readFileSync(pidFile, "utf8"));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(() => process.kill(grandchild, 0)).toThrow();
  }, 20_000);
});

describe("run_command and run stops", () => {
  test("a finished command is not killed again when its run is stopped later", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await withRunControl("run_finished_cmd", async () => {
      expect(await runCommand(tmpdir(), "node -e \"process.stdout.write('ok')\"")).toBe("exit code 0\nok");
      stopRun("run_finished_cmd");
    });
    expect(warn.mock.calls.filter((call) => String(call[0]).startsWith("[run_command] killing"))).toEqual([]);
    warn.mockRestore();
  });
});

describe("command results", () => {
  test("a signal-terminated command is reported as killed, never as exit code 0", () => {
    expect(formatCommandResult(0, null, "built")).toBe("exit code 0\nbuilt");
    expect(formatCommandResult(2, null, "")).toBe("exit code 2\n(no output)");
    expect(formatCommandResult(null, "SIGKILL", "partial")).toBe("ERROR: the command was killed by SIGKILL before it exited; treat it as failed.\npartial");
    expect(formatCommandResult(null, null, "")).toBe("ERROR: the command ended without an exit code; treat it as failed.\n(no output)");
  });
});

describe("the environment a command runs in", () => {
  test("a command sees no inherited secrets and a home of its own, while PATH still finds tools", async () => {
    const root = mkdtempSync(join(tmpdir(), "ac-env-"));
    process.env.AGENTCOMPANY_TEST_SECRET = "sk-should-not-leak";
    try {
      const output = await runCommand(root, "node -e \"console.log(process.env.AGENTCOMPANY_TEST_SECRET ?? 'none'); console.log(require('os').homedir())\"");
      const [code, secret, home] = output.split(/\r?\n/);
      expect(code).toBe("exit code 0");
      expect(secret).toBe("none");
      expect(home).not.toBe(homedir());
      expect(home).toContain("agentcompany-home-");
    } finally {
      delete process.env.AGENTCOMPANY_TEST_SECRET;
    }
  });
});
