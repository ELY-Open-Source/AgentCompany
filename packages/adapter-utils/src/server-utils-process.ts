import { spawn, execSync, type ChildProcess } from "node:child_process";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { appendWithCap, defaultPathForPlatform } from "./server-utils-parsers.js";

/**
 * Decode a Buffer as GBK (CP936). Used as a fallback when UTF-8 decoding
 * produces replacement characters on Chinese Windows systems where the
 * system ANSI code page is GBK and chcp 65001 is ineffective for piped I/O.
 */
function decodeGbkBuffer(buf: Buffer): string {
  try {
    return new TextDecoder("gbk").decode(buf);
  } catch {
    return buf.toString("utf8");
  }
}

export interface RunProcessResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

interface RunningProcess {
  child: ChildProcess;
  graceSec: number;
}

interface SpawnTarget {
  command: string;
  args: string[];
}

type ChildProcessWithEvents = ChildProcess & {
  on(event: "error", listener: (err: Error) => void): ChildProcess;
  on(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): ChildProcess;
};

export const runningProcesses = new Map<string, RunningProcess>();

export function normalizeCommandValue(command: string): string {
  let normalized = command.trim();
  while (normalized.length >= 2) {
    const quote = normalized[0];
    if ((quote !== '"' && quote !== "'") || normalized.at(-1) !== quote) {
      break;
    }
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized;
}

function windowsPathExts(env: NodeJS.ProcessEnv): string[] {
  return (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean);
}

async function pathExists(candidate: string) {
  try {
    await fs.access(candidate, process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveCommandPath(command: string, cwd: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const normalizedCommand = normalizeCommandValue(command);
  const hasPathSeparator = normalizedCommand.includes("/") || normalizedCommand.includes("\\");
  if (hasPathSeparator) {
    const absolute = path.isAbsolute(normalizedCommand) ? normalizedCommand : path.resolve(cwd, normalizedCommand);
    return (await pathExists(absolute)) ? absolute : null;
  }

  const pathValue = env.PATH ?? env.Path ?? "";
  const delimiter = process.platform === "win32" ? ";" : ":";
  const dirs = pathValue.split(delimiter).filter(Boolean);
  const exts = process.platform === "win32" ? windowsPathExts(env) : [""];
  const hasExtension = process.platform === "win32" && path.extname(command).length > 0;

  for (const dir of dirs) {
    const candidates =
      process.platform === "win32"
        ? hasExtension
          ? [path.join(dir, normalizedCommand)]
          : exts.map((ext) => path.join(dir, `${normalizedCommand}${ext}`))
        : [path.join(dir, normalizedCommand)];
    for (const candidate of candidates) {
      if (await pathExists(candidate)) return candidate;
    }
  }

  return null;
}

function quoteForCmd(arg: string) {
  if (!arg.length) return '""';
  const escaped = arg.replace(/"/g, '""');
  return /[\s"&<>|^()]/.test(escaped) ? `"${escaped}"` : escaped;
}

async function resolveSpawnTarget(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<SpawnTarget> {
  const normalizedCommand = normalizeCommandValue(command);
  const resolved = await resolveCommandPath(normalizedCommand, cwd, env);
  const executable = resolved ?? normalizedCommand;

  if (process.platform !== "win32") {
    return { command: executable, args };
  }

  // On Windows, ALL spawned processes need UTF-8 code page (65001) to prevent
  // Chinese/CJK character corruption. The default Windows code page (e.g. 936/GBK)
  // corrupts multi-byte UTF-8 characters passed through cmd.exe, curl, etc.
  const shell = env.ComSpec || process.env.ComSpec || "cmd.exe";
  const commandLine = [quoteForCmd(executable), ...args.map(quoteForCmd)].join(" ");
  return {
    command: shell,
    args: ["/d", "/s", "/c", `chcp 65001 >nul && ${commandLine}`],
  };
}

export function ensurePathInEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (typeof env.PATH === "string" && env.PATH.length > 0) return env;
  if (typeof env.Path === "string" && env.Path.length > 0) return env;
  return { ...env, PATH: defaultPathForPlatform() };
}

export async function ensureAbsoluteDirectory(
  cwd: string,
  opts: { createIfMissing?: boolean } = {},
) {
  if (!path.isAbsolute(cwd)) {
    throw new Error(`Working directory must be an absolute path: "${cwd}"`);
  }

  const assertDirectory = async () => {
    const stats = await fs.stat(cwd);
    if (!stats.isDirectory()) {
      throw new Error(`Working directory is not a directory: "${cwd}"`);
    }
  };

  try {
    await assertDirectory();
    return;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (!opts.createIfMissing || code !== "ENOENT") {
      if (code === "ENOENT") {
        throw new Error(`Working directory does not exist: "${cwd}"`);
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  try {
    await fs.mkdir(cwd, { recursive: true });
    await assertDirectory();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not create working directory "${cwd}": ${reason}`);
  }
}

export async function ensureCommandResolvable(command: string, cwd: string, env: NodeJS.ProcessEnv) {
  const normalizedCommand = normalizeCommandValue(command);
  const resolved = await resolveCommandPath(normalizedCommand, cwd, env);
  if (resolved) return;
  if (normalizedCommand.includes("/") || normalizedCommand.includes("\\")) {
    const absolute = path.isAbsolute(normalizedCommand) ? normalizedCommand : path.resolve(cwd, normalizedCommand);
    throw new Error(`Command is not executable: "${command}" (resolved: "${absolute}")`);
  }
  throw new Error(`Command not found in PATH: "${command}"`);
}

export async function runChildProcess(
  runId: string,
  command: string,
  args: string[],
  opts: {
    cwd: string;
    env: Record<string, string>;
    timeoutSec: number;
    graceSec: number;
    onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
    onLogError?: (err: unknown, runId: string, message: string) => void;
    stdin?: string;
  },
): Promise<RunProcessResult> {
  const onLogError = opts.onLogError ?? ((err, id, msg) => console.warn({ err, runId: id }, msg));

  return new Promise<RunProcessResult>((resolve, reject) => {
    const rawMerged: NodeJS.ProcessEnv = { ...opts.env };

    // Strip Claude Code nesting-guard env vars so spawned `claude` processes
    // don't refuse to start with "cannot be launched inside another session".
    // These vars leak in when the AgentCompany server itself is started from
    // within a Claude Code session (e.g. `npx agentcompany run` in a terminal
    // owned by Claude Code) or when cron inherits a contaminated shell env.
    const CLAUDE_CODE_NESTING_VARS = [
      "CLAUDECODE",
      "CLAUDE_CODE_ENTRYPOINT",
      "CLAUDE_CODE_SESSION",
      "CLAUDE_CODE_PARENT_SESSION",
    ] as const;
    for (const key of CLAUDE_CODE_NESTING_VARS) {
      delete rawMerged[key];
    }

    const mergedEnv = ensurePathInEnv(rawMerged);
    // On Windows, force UTF-8 encoding in child processes to prevent Chinese/CJK
    // character corruption caused by the default system code page (e.g. 936/GBK).
    if (process.platform === "win32") {
      mergedEnv.PYTHONUTF8 = "1";
      mergedEnv.PYTHONIOENCODING = "utf-8";
      if (!mergedEnv.LANG) mergedEnv.LANG = "en_US.UTF-8";
    }

    void resolveSpawnTarget(command, args, opts.cwd, mergedEnv)
      .then((target) => {
        const child = spawn(target.command, target.args, {
          cwd: opts.cwd,
          env: mergedEnv,
          shell: false,
          windowsHide: true,
          stdio: [opts.stdin != null ? "pipe" : "ignore", "pipe", "pipe"],
        }) as ChildProcessWithEvents;

        if (opts.stdin != null && child.stdin) {
          child.stdin.write(opts.stdin);
          child.stdin.end();
        }

        runningProcesses.set(runId, { child, graceSec: opts.graceSec });

        let timedOut = false;
        let stdout = "";
        let stderr = "";
        let logChain: Promise<void> = Promise.resolve();

        // Use StringDecoder to handle multi-byte characters split across chunks.
        // On Windows, child process stdout may arrive in GBK (CP936) instead
        // of UTF-8 when chcp 65001 is ineffective (piped stdout has no console).
        // We detect this per-stream and fall back to GBK decoding if needed.
        const stdoutDecoder = new StringDecoder("utf8");
        const stderrDecoder = new StringDecoder("utf8");
        let stdoutIsGbk = false;
        let stderrIsGbk = false;

        const timeout =
          opts.timeoutSec > 0
            ? setTimeout(() => {
                timedOut = true;
                child.kill("SIGTERM");
                setTimeout(() => {
                  if (!child.killed) {
                    child.kill("SIGKILL");
                  }
                }, Math.max(1, opts.graceSec) * 1000);
              }, opts.timeoutSec * 1000)
            : null;

        child.stdout?.on("data", (chunk: unknown) => {
          let text: string;
          if (chunk instanceof Buffer) {
            if (stdoutIsGbk) {
              text = decodeGbkBuffer(chunk);
            } else {
              text = stdoutDecoder.write(chunk);
              if (text.includes("\ufffd") && chunk.length > 0) {
                stdoutIsGbk = true;
                text = decodeGbkBuffer(chunk);
              }
            }
          } else {
            text = String(chunk);
          }
          stdout = appendWithCap(stdout, text);
          logChain = logChain
            .then(() => opts.onLog("stdout", text))
            .catch((err) => onLogError(err, runId, "failed to append stdout log chunk"));
        });

        child.stderr?.on("data", (chunk: unknown) => {
          let text: string;
          if (chunk instanceof Buffer) {
            if (stderrIsGbk) {
              text = decodeGbkBuffer(chunk);
            } else {
              text = stderrDecoder.write(chunk);
              if (text.includes("\ufffd") && chunk.length > 0) {
                stderrIsGbk = true;
                text = decodeGbkBuffer(chunk);
              }
            }
          } else {
            text = String(chunk);
          }
          stderr = appendWithCap(stderr, text);
          logChain = logChain
            .then(() => opts.onLog("stderr", text))
            .catch((err) => onLogError(err, runId, "failed to append stderr log chunk"));
        });

        child.on("error", (err: Error) => {
          if (timeout) clearTimeout(timeout);
          runningProcesses.delete(runId);
          const errno = (err as NodeJS.ErrnoException).code;
          const pathValue = mergedEnv.PATH ?? mergedEnv.Path ?? "";
          const msg =
            errno === "ENOENT"
              ? `Failed to start command "${command}" in "${opts.cwd}". Verify adapter command, working directory, and PATH (${pathValue}).`
              : `Failed to start command "${command}" in "${opts.cwd}": ${err.message}`;
          reject(new Error(msg));
        });

        child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
          if (timeout) clearTimeout(timeout);
          runningProcesses.delete(runId);
          // Flush any remaining partial multi-byte characters from the decoders.
          const stdoutTail = stdoutDecoder.end();
          const stderrTail = stderrDecoder.end();
          if (stdoutTail) stdout = appendWithCap(stdout, stdoutTail);
          if (stderrTail) stderr = appendWithCap(stderr, stderrTail);
          void logChain.finally(() => {
            resolve({
              exitCode: code,
              signal,
              timedOut,
              stdout,
              stderr,
            });
          });
        });
      })
      .catch(reject);
  });
}

/**
 * Kill a process and all its descendants.
 * Windows: `taskkill /T /F` kills the full process tree.
 * Unix:    SIGKILL the process directly (CLI tools are leaf processes).
 */
function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /T /F /PID ${pid}`, { stdio: "ignore", timeout: 5000 });
    } catch { /* process already exited */ }
  } else {
    try {
      process.kill(pid, "SIGKILL");
    } catch { /* already dead */ }
  }
}

/**
 * Force-kill every child process tracked in `runningProcesses` and clear the map.
 * Called by the worker during shutdown to ensure no CLI processes survive app quit.
 */
export function shutdownAllRunning(): void {
  for (const [runId, entry] of runningProcesses) {
    const pid = entry.child.pid;
    if (pid != null) {
      killProcessTree(pid);
    }
    runningProcesses.delete(runId);
  }
}
