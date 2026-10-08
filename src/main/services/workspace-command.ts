import { spawn, spawnSync } from "node:child_process";
import { currentRunSignal } from "./run-control";

const COMMAND_TIMEOUT_MS = 120_000;
const KEEP_BYTES = 8_000;

/** Keeps the first and last KEEP_BYTES of a stream and counts what it drops. */
export class BoundedOutput {
  private head: Buffer = Buffer.alloc(0);
  private tail: Buffer = Buffer.alloc(0);
  private dropped = 0;

  push(chunk: Buffer): void {
    let rest = chunk;
    if (this.head.length < KEEP_BYTES) {
      const room = KEEP_BYTES - this.head.length;
      this.head = ownCopy(Buffer.concat([this.head, rest.subarray(0, room)]));
      rest = rest.subarray(room);
    }
    if (rest.length === 0) return;
    const joined = Buffer.concat([this.tail, rest]);
    const overflow = Math.max(0, joined.length - KEEP_BYTES);
    this.dropped += overflow;
    this.tail = ownCopy(joined.subarray(overflow));
  }

  /** Bytes of memory the kept output occupies. */
  retainedBytes(): number {
    return this.head.buffer.byteLength + this.tail.buffer.byteLength;
  }

  text(): string {
    if (this.dropped === 0) return Buffer.concat([this.head, this.tail]).toString("utf8");
    const gap = `\n[... ${this.dropped} bytes of output dropped ...]\n`;
    return `${this.head.toString("utf8")}${gap}${this.tail.toString("utf8")}`;
  }
}

/** A standalone allocation, so a small view never pins a large chunk. */
function ownCopy(view: Buffer): Buffer {
  const copy = Buffer.allocUnsafeSlow(view.length);
  view.copy(copy);
  return copy;
}

export function runCommand(workspaceRoot: string, command: string, options: { timeoutMs?: number } = {}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
  return new Promise((resolvePromise) => {
    // Its own process group on POSIX, so the whole tree can be killed at once.
    const child = spawn(command, { shell: true, cwd: workspaceRoot, windowsHide: true, detached: process.platform !== "win32" });
    const output = new BoundedOutput();
    let settled = false;
    const runSignal = currentRunSignal();
    const onStop = (): void => abandon("ERROR: the run was stopped and the command was killed.");
    const finish = (text: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      runSignal?.removeEventListener("abort", onStop);
      resolvePromise(text);
    };
    // Children can outlive the shell and keep the pipes open, so stop reading instead of waiting for close.
    const abandon = (text: string): void => {
      if (settled) return;
      const killFailure = killProcessTree(child.pid);
      child.stdout.destroy();
      child.stderr.destroy();
      finish(killFailure ? `${text} Killing it failed, so it may still be running: ${killFailure}` : text);
    };
    const timer = setTimeout(() => {
      abandon(`ERROR: command timed out after ${timeoutMs / 1000}s and was killed. Partial output:\n${output.text()}`);
    }, timeoutMs);
    runSignal?.addEventListener("abort", onStop, { once: true });
    const collect = (chunk: Buffer): void => output.push(chunk);
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => finish(`ERROR: ${error.message}`));
    child.on("close", (code) => {
      finish(`exit code ${code ?? 0}\n${output.text().trim() || "(no output)"}`);
    });
  });
}

/** Kills a process and every process it started; returns why that failed, or null. */
function killProcessTree(pid: number | undefined): string | null {
  if (pid === undefined) return null;
  console.warn(`[run_command] killing process tree ${pid}`);
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, encoding: "utf8" });
    if (result.error) return result.error.message;
    // 128: the process already exited.
    if (result.status !== 0 && result.status !== 128) return (result.stderr || result.stdout || `taskkill exited ${result.status}`).trim();
    return null;
  }
  try {
    process.kill(-pid, "SIGKILL");
    return null;
  } catch (error) {
    // ESRCH: the group already exited.
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return null;
    return (error as Error).message;
  }
}
