import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@agentcompany/adapter-utils";
import {
  asString,
  asBoolean,
  asNumber,
  asStringArray,
  parseObject,
  ensureAbsoluteDirectory,
  ensureCommandResolvable,
  ensurePathInEnv,
  runChildProcess,
} from "@agentcompany/adapter-utils/server-utils";
import path from "node:path";
import { detectClaudeLoginRequired, parseClaudeStreamJson } from "./parse.js";

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function commandLooksLike(command: string, expected: string): boolean {
  const base = path.basename(command).toLowerCase();
  return base === expected || base === `${expected}.cmd` || base === `${expected}.exe`;
}

function summarizeProbeDetail(stdout: string, stderr: string): string | null {
  const raw = firstNonEmptyLine(stderr) || firstNonEmptyLine(stdout);
  if (!raw) return null;
  const clean = raw.replace(/\s+/g, " ").trim();
  const max = 240;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const command = asString(config.command, "claude");
  const cwd = asString(config.cwd, process.cwd());

  try {
    await ensureAbsoluteDirectory(cwd, { createIfMissing: true });
    checks.push({ code: "claude_cwd_valid", level: "info", message: `Working directory is valid: ${cwd}` });
  } catch (err) {
    checks.push({ code: "claude_cwd_invalid", level: "error", message: err instanceof Error ? err.message : "Invalid working directory", detail: cwd });
  }

  const envConfig = parseObject(config.env);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }
  const runtimeEnv = ensurePathInEnv(env);
  try {
    await ensureCommandResolvable(command, cwd, runtimeEnv);
    checks.push({ code: "claude_command_resolvable", level: "info", message: `Command is executable: ${command}` });
  } catch (err) {
    checks.push({ code: "claude_command_unresolvable", level: "error", message: err instanceof Error ? err.message : "Command is not executable", detail: command });
  }

  const configApiKey = env.ANTHROPIC_API_KEY;
  if (isNonEmpty(configApiKey)) {
    checks.push({ code: "claude_anthropic_api_key_overrides_subscription", level: "info", message: "ANTHROPIC_API_KEY is set. Claude will use API-key auth." });
  } else {
    checks.push({ code: "claude_subscription_mode_possible", level: "info", message: "ANTHROPIC_API_KEY is not set; subscription-based auth can be used if Claude is logged in." });
  }

  // Hello probe: wrapped in try-catch so probe failures never crash the test.
  // If the command is resolvable, that is sufficient for "pass" status.
  const canRunProbe = checks.every((c) => c.code !== "claude_cwd_invalid" && c.code !== "claude_command_unresolvable");
  if (canRunProbe && commandLooksLike(command, "claude")) {
    try {
      const model = asString(config.model, "").trim();
      const effort = asString(config.effort, "").trim();
      const chrome = asBoolean(config.chrome, false);
      const maxTurns = asNumber(config.maxTurnsPerRun, 0);
      const dangerouslySkipPermissions = asBoolean(config.dangerouslySkipPermissions, false);
      const extraArgs = (() => {
        const fromExtraArgs = asStringArray(config.extraArgs);
        if (fromExtraArgs.length > 0) return fromExtraArgs;
        return asStringArray(config.args);
      })();

      const args = ["--print", "-", "--output-format", "stream-json", "--verbose"];
      if (dangerouslySkipPermissions) args.push("--dangerously-skip-permissions");
      if (chrome) args.push("--chrome");
      if (model) args.push("--model", model);
      if (effort) args.push("--effort", effort);
      if (maxTurns > 0) args.push("--max-turns", String(maxTurns));
      if (extraArgs.length > 0) args.push(...extraArgs);

      const probe = await runChildProcess(
        `claude-envtest-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        command,
        args,
        { cwd, env, timeoutSec: 45, graceSec: 5, stdin: "Respond with hello.", onLog: async () => {} },
      );

      const parsedStream = parseClaudeStreamJson(probe.stdout);
      const parsed = parsedStream.resultJson;
      const loginMeta = detectClaudeLoginRequired({ parsed, stdout: probe.stdout, stderr: probe.stderr });
      const detail = summarizeProbeDetail(probe.stdout, probe.stderr);

      if (probe.timedOut) {
        checks.push({ code: "claude_hello_probe_timed_out", level: "info", message: "Claude hello probe timed out." });
      } else if (loginMeta.requiresLogin) {
        checks.push({
          code: "claude_hello_probe_auth_required", level: "warn",
          message: "Claude CLI is installed, but login is required.",
          ...(detail ? { detail } : {}),
          hint: loginMeta.loginUrl ? `Run \`claude login\` at ${loginMeta.loginUrl}` : "Run `claude login` first.",
        });
      } else if ((probe.exitCode ?? 1) === 0) {
        const summary = parsedStream.summary.trim();
        const hasHello = /\bhello\b/i.test(summary);
        checks.push({
          code: hasHello ? "claude_hello_probe_passed" : "claude_hello_probe_unexpected_output",
          level: "info",
          message: hasHello ? "Claude hello probe succeeded." : "Claude probe completed.",
          ...(summary ? { detail: summary.replace(/\s+/g, " ").trim().slice(0, 240) } : {}),
        });
      } else {
        checks.push({ code: "claude_hello_probe_failed", level: "info", message: "Claude hello probe exited with non-zero code.", ...(detail ? { detail } : {}) });
      }
    } catch {
      // Probe failed to run — command is still resolvable so this is non-fatal.
      checks.push({ code: "claude_hello_probe_error", level: "info", message: "Claude hello probe could not run." });
    }
  }

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
