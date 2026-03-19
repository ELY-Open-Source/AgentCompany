import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@agentcompany/adapter-utils";
import {
  asString,
  asBoolean,
  asStringArray,
  parseObject,
  ensureAbsoluteDirectory,
  ensureCommandResolvable,
  ensurePathInEnv,
  runChildProcess,
} from "@agentcompany/adapter-utils/server-utils";
import path from "node:path";
import { parseCodexJsonl } from "./parse.js";

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

function summarizeProbeDetail(stdout: string, stderr: string, parsedError: string | null): string | null {
  const raw = parsedError?.trim() || firstNonEmptyLine(stderr) || firstNonEmptyLine(stdout);
  if (!raw) return null;
  const clean = raw.replace(/\s+/g, " ").trim();
  const max = 240;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

const CODEX_AUTH_REQUIRED_RE =
  /(?:not\s+logged\s+in|login\s+required|authentication\s+required|unauthorized|invalid(?:\s+or\s+missing)?\s+api(?:[_\s-]?key)?|openai[_\s-]?api[_\s-]?key|api[_\s-]?key.*required|please\s+run\s+`?codex\s+login`?)/i;

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const command = asString(config.command, "codex");
  const cwd = asString(config.cwd, process.cwd());

  try {
    await ensureAbsoluteDirectory(cwd, { createIfMissing: true });
    checks.push({ code: "codex_cwd_valid", level: "info", message: `Working directory is valid: ${cwd}` });
  } catch (err) {
    checks.push({ code: "codex_cwd_invalid", level: "error", message: err instanceof Error ? err.message : "Invalid working directory", detail: cwd });
  }

  const envConfig = parseObject(config.env);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }
  const runtimeEnv = ensurePathInEnv(env);
  try {
    await ensureCommandResolvable(command, cwd, runtimeEnv);
    checks.push({ code: "codex_command_resolvable", level: "info", message: `Command is executable: ${command}` });
  } catch (err) {
    checks.push({ code: "codex_command_unresolvable", level: "error", message: err instanceof Error ? err.message : "Command is not executable", detail: command });
  }

  const configOpenAiKey = env.OPENAI_API_KEY;
  if (isNonEmpty(configOpenAiKey)) {
    checks.push({ code: "codex_openai_api_key_present", level: "info", message: "OPENAI_API_KEY is set for Codex authentication." });
  } else {
    checks.push({ code: "codex_openai_api_key_missing", level: "info", message: "OPENAI_API_KEY is not set. Codex may use its own auth configuration." });
  }

  // Hello probe: wrapped in try-catch so probe failures never crash the test.
  const canRunProbe = checks.every((c) => c.code !== "codex_cwd_invalid" && c.code !== "codex_command_unresolvable");
  if (canRunProbe && commandLooksLike(command, "codex")) {
    try {
      const model = asString(config.model, "").trim();
      const modelReasoningEffort = asString(config.modelReasoningEffort, asString(config.reasoningEffort, "")).trim();
      const search = asBoolean(config.search, false);
      const bypass = asBoolean(config.dangerouslyBypassApprovalsAndSandbox, asBoolean(config.dangerouslyBypassSandbox, false));
      const extraArgs = (() => {
        const fromExtraArgs = asStringArray(config.extraArgs);
        if (fromExtraArgs.length > 0) return fromExtraArgs;
        return asStringArray(config.args);
      })();

      const args = ["exec", "--json"];
      args.push("--skip-git-repo-check");
      if (search) args.unshift("--search");
      if (bypass) args.push("--dangerously-bypass-approvals-and-sandbox");
      if (model) args.push("--model", model);
      if (modelReasoningEffort) args.push("-c", `model_reasoning_effort=${JSON.stringify(modelReasoningEffort)}`);
      if (extraArgs.length > 0) args.push(...extraArgs);
      args.push("-");

      const probe = await runChildProcess(
        `codex-envtest-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        command,
        args,
        { cwd, env, timeoutSec: 45, graceSec: 5, stdin: "Respond with hello.", onLog: async () => {} },
      );
      const parsed = parseCodexJsonl(probe.stdout);
      const detail = summarizeProbeDetail(probe.stdout, probe.stderr, parsed.errorMessage);
      const authEvidence = `${parsed.errorMessage ?? ""}\n${probe.stdout}\n${probe.stderr}`.trim();

      if (probe.timedOut) {
        checks.push({ code: "codex_hello_probe_timed_out", level: "info", message: "Codex hello probe timed out." });
      } else if ((probe.exitCode ?? 1) === 0) {
        const summary = parsed.summary.trim();
        const hasHello = /\bhello\b/i.test(summary);
        checks.push({
          code: hasHello ? "codex_hello_probe_passed" : "codex_hello_probe_unexpected_output",
          level: "info",
          message: hasHello ? "Codex hello probe succeeded." : "Codex probe completed.",
          ...(summary ? { detail: summary.replace(/\s+/g, " ").trim().slice(0, 240) } : {}),
        });
      } else if (CODEX_AUTH_REQUIRED_RE.test(authEvidence)) {
        checks.push({
          code: "codex_hello_probe_auth_required", level: "warn",
          message: "Codex CLI is installed, but authentication is not ready.",
          ...(detail ? { detail } : {}),
          hint: "Configure OPENAI_API_KEY or run `codex login`.",
        });
      } else {
        checks.push({ code: "codex_hello_probe_failed", level: "info", message: "Codex hello probe exited with non-zero code.", ...(detail ? { detail } : {}) });
      }
    } catch {
      checks.push({ code: "codex_hello_probe_error", level: "info", message: "Codex hello probe could not run." });
    }
  }

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
