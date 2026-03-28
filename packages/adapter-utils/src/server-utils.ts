import { spawn, type ChildProcess } from "node:child_process";
import { constants as fsConstants, promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { AdapterSkillEntry, AdapterSkillSnapshot, ManagedSkillRef } from "./types.js";

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
export const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;
export const MAX_EXCERPT_BYTES = 32 * 1024;
const SENSITIVE_ENV_KEY = /(key|token|secret|password|passwd|authorization|cookie)/i;

export function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function parseJson(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function appendWithCap(prev: string, chunk: string, cap = MAX_CAPTURE_BYTES) {
  const combined = prev + chunk;
  return combined.length > cap ? combined.slice(combined.length - cap) : combined;
}

export function resolvePathValue(obj: Record<string, unknown>, dottedPath: string) {
  const parts = dottedPath.split(".");
  let cursor: unknown = obj;

  for (const part of parts) {
    if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor)) {
      return "";
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }

  if (cursor === null || cursor === undefined) return "";
  if (typeof cursor === "string") return cursor;
  if (typeof cursor === "number" || typeof cursor === "boolean") return String(cursor);

  try {
    return JSON.stringify(cursor);
  } catch {
    return "";
  }
}

export function renderTemplate(template: string, data: Record<string, unknown>) {
  return template.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_, path) => resolvePathValue(data, path));
}

/**
 * Remove flags from `extraArgs` that the adapter will already add itself.
 * Handles both `--flag value` pairs and `--flag=value` forms.
 * This prevents duplicate/conflicting CLI arguments when users have shell
 * aliases or wrapper functions that inject the same flags.
 */
export function filterConflictingArgs(extraArgs: string[], adapterFlags: string[]): string[] {
  const flagSet = new Set(adapterFlags.map((f) => f.replace(/=.*$/, "")));
  const filtered: string[] = [];
  for (let i = 0; i < extraArgs.length; i++) {
    const arg = extraArgs[i];
    const bareFlag = arg.replace(/=.*$/, "");
    if (flagSet.has(bareFlag)) {
      // Skip this flag and its value if the value is a separate argument
      if (!arg.includes("=") && i + 1 < extraArgs.length && !extraArgs[i + 1].startsWith("-")) {
        i++; // skip the value argument too
      }
      continue;
    }
    filtered.push(arg);
  }
  return filtered;
}

export function redactEnvForLogs(env: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    redacted[key] = SENSITIVE_ENV_KEY.test(key) ? "***REDACTED***" : value;
  }
  return redacted;
}

export function buildAgentCompanyEnv(agent: { id: string; companyId: string }): Record<string, string> {
  const resolveHostForUrl = (rawHost: string): string => {
    const host = rawHost.trim();
    if (!host || host === "0.0.0.0" || host === "::") return "localhost";
    if (host.includes(":") && !host.startsWith("[") && !host.endsWith("]")) return `[${host}]`;
    return host;
  };
  const vars: Record<string, string> = {
    AGENT_COMPANY_AGENT_ID: agent.id,
    AGENT_COMPANY_COMPANY_ID: agent.companyId,
  };
  const runtimeHost = resolveHostForUrl(
    process.env.AGENT_COMPANY_LISTEN_HOST ?? process.env.HOST ?? "localhost",
  );
  const runtimePort = process.env.AGENT_COMPANY_LISTEN_PORT ?? process.env.PORT ?? "3100";
  const apiUrl = process.env.AGENT_COMPANY_API_URL ?? `http://${runtimeHost}:${runtimePort}`;
  vars.AGENT_COMPANY_API_URL = apiUrl;
  return vars;
}

export function defaultPathForPlatform() {
  if (process.platform === "win32") {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
    const appData = process.env.APPDATA ?? (home ? `${home}\\AppData\\Roaming` : "");
    const localAppData = process.env.LOCALAPPDATA ?? (home ? `${home}\\AppData\\Local` : "");
    const parts = [
      "C:\\Windows\\System32",
      "C:\\Windows",
      "C:\\Windows\\System32\\Wbem",
      appData ? `${appData}\\npm` : "",
      localAppData ? `${localAppData}\\pnpm` : "",
      home ? `${home}\\.local\\bin` : "",
      home ? `${home}\\.cargo\\bin` : "",
      "C:\\Program Files\\nodejs",
    ].filter(Boolean);
    return parts.join(";");
  }
  return "/usr/local/bin:/opt/homebrew/bin:/usr/local/sbin:/usr/bin:/bin:/usr/sbin:/sbin";
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
  const hasPathSeparator = command.includes("/") || command.includes("\\");
  if (hasPathSeparator) {
    const absolute = path.isAbsolute(command) ? command : path.resolve(cwd, command);
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
          ? [path.join(dir, command)]
          : exts.map((ext) => path.join(dir, `${command}${ext}`))
        : [path.join(dir, command)];
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
  const resolved = await resolveCommandPath(command, cwd, env);
  const executable = resolved ?? command;

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
  const resolved = await resolveCommandPath(command, cwd, env);
  if (resolved) return;
  if (command.includes("/") || command.includes("\\")) {
    const absolute = path.isAbsolute(command) ? command : path.resolve(cwd, command);
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
 * Create symlinks for managed skills in the target directory.
 * Per D-13: uses 'junction' type on Windows to avoid Developer Mode requirement.
 * Falls back gracefully -- skill injection is best-effort and should not block runs.
 */
export async function createManagedSkillSymlinks(
  managedSkills: ManagedSkillRef[],
  targetDir: string,
  onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void>,
): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true });
  const symlinkType = process.platform === "win32" ? ("junction" as const) : undefined;
  for (const skill of managedSkills) {
    const target = path.join(targetDir, skill.runtimeName);
    const existing = await fs.lstat(target).catch(() => null);
    if (existing) {
      // Remove stale symlink from previous run
      await fs.rm(target, { recursive: true, force: true }).catch(() => {});
    }
    try {
      await fs.symlink(skill.sourcePath, target, symlinkType);
      await onLog("stderr", `[agent-company] Injected managed skill "${skill.runtimeName}"\n`);
    } catch (err) {
      await onLog(
        "stderr",
        `[agent-company] Failed to inject skill "${skill.runtimeName}": ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Skill resolution helpers -- ported from Paperclip reference with
// AgentCompany naming. These utilities let each adapter discover, list,
// resolve, and synchronize skills from a shared skills directory.
// ---------------------------------------------------------------------------

const AGENTCOMPANY_SKILL_ROOT_RELATIVE_CANDIDATES = [
  "../../skills",
  "../../../../../skills",
];

export interface AgentCompanySkillEntry {
  key: string;
  runtimeName: string;
  source: string;
  required?: boolean;
  requiredReason?: string | null;
}

export interface InstalledSkillTarget {
  targetPath: string | null;
  kind: "symlink" | "directory" | "file";
}

interface PersistentSkillSnapshotOptions {
  adapterType: string;
  availableEntries: AgentCompanySkillEntry[];
  desiredSkills: string[];
  installed: Map<string, InstalledSkillTarget>;
  skillsHome: string;
  locationLabel?: string | null;
  installedDetail?: string | null;
  missingDetail: string;
  externalConflictDetail: string;
  externalDetail: string;
  warnings?: string[];
}

function normalizePathSlashes(value: string): string {
  return value.replaceAll("\\", "/");
}

function isMaintainerOnlySkillTarget(candidate: string): boolean {
  return normalizePathSlashes(candidate).includes("/.agents/skills/");
}

function skillLocationLabel(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildManagedSkillOrigin(entry: { required?: boolean }): Pick<
  AdapterSkillEntry,
  "origin" | "originLabel" | "readOnly"
> {
  if (entry.required) {
    return {
      origin: "paperclip_required",
      originLabel: "Required by AgentCompany",
      readOnly: false,
    };
  }
  return {
    origin: "company_managed",
    originLabel: "Managed by AgentCompany",
    readOnly: false,
  };
}

function resolveInstalledEntryTarget(
  skillsHome: string,
  entryName: string,
  dirent: Dirent,
  linkedPath: string | null,
): InstalledSkillTarget {
  const fullPath = path.join(skillsHome, entryName);
  if (dirent.isSymbolicLink()) {
    return {
      targetPath: linkedPath ? path.resolve(path.dirname(fullPath), linkedPath) : null,
      kind: "symlink",
    };
  }
  if (dirent.isDirectory()) {
    return { targetPath: fullPath, kind: "directory" };
  }
  return { targetPath: fullPath, kind: "file" };
}

function normalizeConfiguredAgentCompanyRuntimeSkills(value: unknown): AgentCompanySkillEntry[] {
  if (!Array.isArray(value)) return [];
  const out: AgentCompanySkillEntry[] = [];
  for (const rawEntry of value) {
    const entry = parseObject(rawEntry);
    const key = asString(entry.key, asString(entry.name, "")).trim();
    const runtimeName = asString(entry.runtimeName, asString(entry.name, "")).trim();
    const source = asString(entry.source, "").trim();
    if (!key || !runtimeName || !source) continue;
    out.push({
      key,
      runtimeName,
      source,
      required: asBoolean(entry.required, false),
      requiredReason:
        typeof entry.requiredReason === "string" && entry.requiredReason.trim().length > 0
          ? entry.requiredReason.trim()
          : null,
    });
  }
  return out;
}

function canonicalizeDesiredAgentCompanySkillReference(
  reference: string,
  availableEntries: Array<{ key: string; runtimeName?: string | null }>,
): string {
  const normalizedReference = reference.trim().toLowerCase();
  if (!normalizedReference) return "";

  const exactKey = availableEntries.find((entry) => entry.key.trim().toLowerCase() === normalizedReference);
  if (exactKey) return exactKey.key;

  const byRuntimeName = availableEntries.filter((entry) =>
    typeof entry.runtimeName === "string" && entry.runtimeName.trim().toLowerCase() === normalizedReference,
  );
  if (byRuntimeName.length === 1) return byRuntimeName[0]!.key;

  const slugMatches = availableEntries.filter((entry) =>
    entry.key.trim().toLowerCase().split("/").pop() === normalizedReference,
  );
  if (slugMatches.length === 1) return slugMatches[0]!.key;

  return normalizedReference;
}

// ---------------------------------------------------------------------------
// Exported skill resolution functions
// ---------------------------------------------------------------------------

/**
 * Resolve the AgentCompany skills root directory from relative path candidates.
 */
export async function resolveAgentCompanySkillsDir(
  moduleDir: string,
  additionalCandidates: string[] = [],
): Promise<string | null> {
  const candidates = [
    ...AGENTCOMPANY_SKILL_ROOT_RELATIVE_CANDIDATES.map((relativePath) => path.resolve(moduleDir, relativePath)),
    ...additionalCandidates.map((candidate) => path.resolve(candidate)),
  ];
  const seenRoots = new Set<string>();

  for (const root of candidates) {
    if (seenRoots.has(root)) continue;
    seenRoots.add(root);
    const isDirectory = await fs.stat(root).then((stats) => stats.isDirectory()).catch(() => false);
    if (isDirectory) return root;
  }

  return null;
}

/**
 * List skill entries from the AgentCompany skills directory.
 */
export async function listAgentCompanySkillEntries(
  moduleDir: string,
  additionalCandidates: string[] = [],
): Promise<AgentCompanySkillEntry[]> {
  const root = await resolveAgentCompanySkillsDir(moduleDir, additionalCandidates);
  if (!root) return [];

  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        key: `agentcompany/agentcompany/${entry.name}`,
        runtimeName: entry.name,
        source: path.join(root, entry.name),
        required: true,
        requiredReason: "Bundled AgentCompany skills are always available for local adapters.",
      }));
  } catch {
    return [];
  }
}

/**
 * Read installed skill targets from a skill home directory (symlinks, dirs, files).
 */
export async function readInstalledSkillTargets(skillsHome: string): Promise<Map<string, InstalledSkillTarget>> {
  const entries = await fs.readdir(skillsHome, { withFileTypes: true }).catch(() => []);
  const out = new Map<string, InstalledSkillTarget>();
  for (const entry of entries) {
    const fullPath = path.join(skillsHome, entry.name);
    const linkedPath = entry.isSymbolicLink() ? await fs.readlink(fullPath).catch(() => null) : null;
    out.set(entry.name, resolveInstalledEntryTarget(skillsHome, entry.name, entry, linkedPath));
  }
  return out;
}

/**
 * Build an AdapterSkillSnapshot for persistent-mode adapters (Gemini, Codex).
 * Compares available entries against installed state and desired skill list.
 */
export function buildPersistentSkillSnapshot(
  options: PersistentSkillSnapshotOptions,
): AdapterSkillSnapshot {
  const {
    adapterType,
    availableEntries,
    desiredSkills,
    installed,
    skillsHome,
    locationLabel,
    installedDetail,
    missingDetail,
    externalConflictDetail,
    externalDetail,
  } = options;
  const availableByKey = new Map(availableEntries.map((entry) => [entry.key, entry]));
  const desiredSet = new Set(desiredSkills);
  const entries: AdapterSkillEntry[] = [];
  const warnings = [...(options.warnings ?? [])];

  for (const available of availableEntries) {
    const installedEntry = installed.get(available.runtimeName) ?? null;
    const desired = desiredSet.has(available.key);
    let state: AdapterSkillEntry["state"] = "available";
    let managed = false;
    let detail: string | null = null;

    if (installedEntry?.targetPath === available.source) {
      managed = true;
      state = desired ? "installed" : "stale";
      detail = installedDetail ?? null;
    } else if (installedEntry) {
      state = "external";
      detail = desired ? externalConflictDetail : externalDetail;
    } else if (desired) {
      state = "missing";
      detail = missingDetail;
    }

    entries.push({
      key: available.key,
      runtimeName: available.runtimeName,
      desired,
      managed,
      state,
      sourcePath: available.source,
      targetPath: path.join(skillsHome, available.runtimeName),
      detail,
      required: Boolean(available.required),
      requiredReason: available.requiredReason ?? null,
      ...buildManagedSkillOrigin(available),
    });
  }

  for (const desiredSkill of desiredSkills) {
    if (availableByKey.has(desiredSkill)) continue;
    warnings.push(`Desired skill "${desiredSkill}" is not available from the AgentCompany skills directory.`);
    entries.push({
      key: desiredSkill,
      runtimeName: null,
      desired: true,
      managed: true,
      state: "missing",
      sourcePath: null,
      targetPath: null,
      detail: "AgentCompany cannot find this skill in the local runtime skills directory.",
      origin: "external_unknown",
      originLabel: "External or unavailable",
      readOnly: false,
    });
  }

  for (const [name, installedEntry] of installed.entries()) {
    if (availableEntries.some((entry) => entry.runtimeName === name)) continue;
    entries.push({
      key: name,
      runtimeName: name,
      desired: false,
      managed: false,
      state: "external",
      origin: "user_installed",
      originLabel: "User-installed",
      locationLabel: skillLocationLabel(locationLabel),
      readOnly: true,
      sourcePath: null,
      targetPath: installedEntry.targetPath ?? path.join(skillsHome, name),
      detail: externalDetail,
    });
  }

  entries.sort((left, right) => left.key.localeCompare(right.key));

  return {
    adapterType,
    supported: true,
    mode: "persistent",
    desiredSkills,
    entries,
    warnings,
  };
}

/**
 * Read runtime skill entries from adapter config or discover from module directory.
 */
export async function readAgentCompanyRuntimeSkillEntries(
  config: Record<string, unknown>,
  moduleDir: string,
  additionalCandidates: string[] = [],
): Promise<AgentCompanySkillEntry[]> {
  const configuredEntries = normalizeConfiguredAgentCompanyRuntimeSkills(config.agentCompanyRuntimeSkills);
  if (configuredEntries.length > 0) return configuredEntries;
  return listAgentCompanySkillEntries(moduleDir, additionalCandidates);
}

/**
 * Read the desired skill sync preference from adapter config.
 */
export function readAgentCompanySkillSyncPreference(config: Record<string, unknown>): {
  explicit: boolean;
  desiredSkills: string[];
} {
  const raw = config.agentCompanySkillSync;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { explicit: false, desiredSkills: [] };
  }
  const syncConfig = raw as Record<string, unknown>;
  const desiredValues = syncConfig.desiredSkills;
  const desired = Array.isArray(desiredValues)
    ? desiredValues
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
  return {
    explicit: Object.prototype.hasOwnProperty.call(raw, "desiredSkills"),
    desiredSkills: Array.from(new Set(desired)),
  };
}

/**
 * Resolve the canonical desired skill list from config and available entries.
 * Required skills are always included; explicit preferences are canonicalized.
 */
export function resolveAgentCompanyDesiredSkillNames(
  config: Record<string, unknown>,
  availableEntries: Array<{ key: string; runtimeName?: string | null; required?: boolean }>,
): string[] {
  const preference = readAgentCompanySkillSyncPreference(config);
  const requiredSkills = availableEntries
    .filter((entry) => entry.required)
    .map((entry) => entry.key);
  if (!preference.explicit) {
    return Array.from(new Set(requiredSkills));
  }
  const desiredSkills = preference.desiredSkills
    .map((reference) => canonicalizeDesiredAgentCompanySkillReference(reference, availableEntries))
    .filter(Boolean);
  return Array.from(new Set([...requiredSkills, ...desiredSkills]));
}

/**
 * Write desired skills back to adapter config.
 */
export function writeAgentCompanySkillSyncPreference(
  config: Record<string, unknown>,
  desiredSkills: string[],
): Record<string, unknown> {
  const next = { ...config };
  const raw = next.agentCompanySkillSync;
  const current =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  current.desiredSkills = Array.from(
    new Set(
      desiredSkills
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
  next.agentCompanySkillSync = current;
  return next;
}

/**
 * Create or repair a symlink from source to target skill directory.
 * Returns the action taken: "created", "repaired", or "skipped".
 */
export async function ensureAgentCompanySkillSymlink(
  source: string,
  target: string,
  linkSkill: (source: string, target: string) => Promise<void> = (linkSource, linkTarget) =>
    fs.symlink(linkSource, linkTarget),
): Promise<"created" | "repaired" | "skipped"> {
  const existing = await fs.lstat(target).catch(() => null);
  if (!existing) {
    await linkSkill(source, target);
    return "created";
  }

  if (!existing.isSymbolicLink()) {
    return "skipped";
  }

  const linkedPath = await fs.readlink(target).catch(() => null);
  if (!linkedPath) return "skipped";

  const resolvedLinkedPath = path.resolve(path.dirname(target), linkedPath);
  if (resolvedLinkedPath === source) {
    return "skipped";
  }

  const linkedPathExists = await fs.stat(resolvedLinkedPath).then(() => true).catch(() => false);
  if (linkedPathExists) {
    return "skipped";
  }

  await fs.unlink(target);
  await linkSkill(source, target);
  return "repaired";
}

/**
 * Remove symlinks in skillsHome that point to maintainer-only paths
 * (.agents/skills/) and are not in the allowed set.
 */
export async function removeMaintainerOnlySkillSymlinks(
  skillsHome: string,
  allowedSkillNames: Iterable<string>,
): Promise<string[]> {
  const allowed = new Set(Array.from(allowedSkillNames));
  try {
    const entries = await fs.readdir(skillsHome, { withFileTypes: true });
    const removed: string[] = [];
    for (const entry of entries) {
      if (allowed.has(entry.name)) continue;

      const target = path.join(skillsHome, entry.name);
      const existing = await fs.lstat(target).catch(() => null);
      if (!existing?.isSymbolicLink()) continue;

      const linkedPath = await fs.readlink(target).catch(() => null);
      if (!linkedPath) continue;

      const resolvedLinkedPath = path.isAbsolute(linkedPath)
        ? linkedPath
        : path.resolve(path.dirname(target), linkedPath);
      if (
        !isMaintainerOnlySkillTarget(linkedPath) &&
        !isMaintainerOnlySkillTarget(resolvedLinkedPath)
      ) {
        continue;
      }

      await fs.unlink(target);
      removed.push(entry.name);
    }

    return removed;
  } catch {
    return [];
  }
}
