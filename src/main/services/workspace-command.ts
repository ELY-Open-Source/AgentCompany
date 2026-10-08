import { spawn } from "node:child_process";

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

export function runCommand(workspaceRoot: string, command: string): Promise<string> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, { shell: true, cwd: workspaceRoot, windowsHide: true });
    const output = new BoundedOutput();
    let killedByTimeout = false;
    const timer = setTimeout(() => {
      killedByTimeout = true;
      child.kill();
    }, COMMAND_TIMEOUT_MS);
    const collect = (chunk: Buffer): void => output.push(chunk);
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise(`ERROR: ${error.message}`);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const text = output.text();
      if (killedByTimeout) {
        resolvePromise(`ERROR: command timed out after ${COMMAND_TIMEOUT_MS / 1000}s and was killed. Partial output:\n${text}`);
        return;
      }
      resolvePromise(`exit code ${code ?? 0}\n${text.trim() || "(no output)"}`);
    });
  });
}
