import path from "node:path";
import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@agentcompany/adapter-utils";
import {
  asBoolean,
  asString,
  asStringArray,
  ensureAbsoluteDirectory,
  ensureCommandResolvable,
  ensurePathInEnv,
  parseObject,
  runChildProcess,
} from "@agentcompany/adapter-utils/server-utils";
import { DEFAULT_GEMINI_LOCAL_MODEL } from "../index.js";
import { detectGeminiAuthRequired, parseGeminiJsonl } from "./parse.js";
import { firstNonEmptyLine } from "./utils.js";

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const command = asString(config.command, "gemini");
  const cwd = asString(config.cwd, process.cwd());

  try {
    await ensureAbsoluteDirectory(cwd, { createIfMissing: true });
    checks.push({
      code: "gemini_cwd_valid",
      level: "info",
      message: `Working directory is valid: ${cwd}`,
    });
  } catch (err) {
    checks.push({
      code: "gemini_cwd_invalid",
      level: "error",
      message: err instanceof Error ? err.message : "Invalid working directory",
      detail: cwd,
    });
  }

  const envConfig = parseObject(config.env);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }
  const runtimeEnv = ensurePathInEnv(env);
  try {
    await ensureCommandResolvable(command, cwd, runtimeEnv);
    checks.push({
      code: "gemini_command_resolvable",
      level: "info",
      message: `Command is executable: ${command}`,
    });
  } catch (err) {
    checks.push({
      code: "gemini_command_unresolvable",
      level: "error",
      message: err instanceof Error ? err.message : "Command is not executable",
      detail: command,
    });
  }

  const configGeminiApiKey = env.GEMINI_API_KEY;
  const configGoogleApiKey = env.GOOGLE_API_KEY;
  const hasGca = env.GOOGLE_GENAI_USE_GCA === "true";
  if (
    isNonEmpty(configGeminiApiKey) ||
    isNonEmpty(configGoogleApiKey) ||
    hasGca
  ) {
    const source = hasGca
      ? "Google account login (GCA)"
      : "adapter runtime env";
    checks.push({
      code: "gemini_api_key_present",
      level: "info",
      message: "Gemini API credentials are set for CLI authentication.",
      detail: `Detected in ${source}.`,
    });
  } else {
    checks.push({
      code: "gemini_api_key_missing",
      level: "info",
      message: "No explicit API key detected. Gemini CLI may still authenticate via `gemini auth login` (OAuth).",
      hint: "If the hello probe fails with an auth error, set GEMINI_API_KEY or GOOGLE_API_KEY in connector secret bindings, or run `gemini auth login`.",
    });
  }

  const canRunProbe =
    checks.every((check) => check.code !== "gemini_cwd_invalid" && check.code !== "gemini_command_unresolvable");
  if (canRunProbe && commandLooksLike(command, "gemini")) {
    try {
      const model = asString(config.model, DEFAULT_GEMINI_LOCAL_MODEL).trim();
      const approvalMode = asString(config.approvalMode, asBoolean(config.yolo, false) ? "yolo" : "default");
      const sandbox = asBoolean(config.sandbox, false);
      const extraArgs = (() => {
        const fromExtraArgs = asStringArray(config.extraArgs);
        if (fromExtraArgs.length > 0) return fromExtraArgs;
        return asStringArray(config.args);
      })();

      const args = ["--output-format", "stream-json"];
      if (model && model !== DEFAULT_GEMINI_LOCAL_MODEL) args.push("--model", model);
      if (approvalMode !== "default") args.push("--approval-mode", approvalMode);
      if (sandbox) {
        args.push("--sandbox");
      } else {
        args.push("--sandbox=none");
      }
      if (extraArgs.length > 0) args.push(...extraArgs);
      args.push("Respond with hello.");

      const probe = await runChildProcess(
        `gemini-envtest-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        command,
        args,
        { cwd, env, timeoutSec: 45, graceSec: 5, onLog: async () => { } },
      );
      const parsed = parseGeminiJsonl(probe.stdout);
      const detail = summarizeProbeDetail(probe.stdout, probe.stderr, parsed.errorMessage);
      const authMeta = detectGeminiAuthRequired({ parsed: parsed.resultEvent, stdout: probe.stdout, stderr: probe.stderr });

      if (probe.timedOut) {
        checks.push({ code: "gemini_hello_probe_timed_out", level: "info", message: "Gemini hello probe timed out." });
      } else if ((probe.exitCode ?? 1) === 0) {
        const summary = parsed.summary.trim();
        checks.push({ code: "gemini_hello_probe_passed", level: "info", message: "Gemini probe completed.", ...(summary ? { detail: summary.replace(/\s+/g, " ").trim().slice(0, 240) } : {}) });
      } else if (authMeta.requiresAuth) {
        checks.push({
          code: "gemini_hello_probe_auth_required", level: "warn",
          message: "Gemini CLI is installed, but authentication is not ready.",
          ...(detail ? { detail } : {}),
          hint: "Run `gemini auth` or configure GEMINI_API_KEY / GOOGLE_API_KEY.",
        });
      } else {
        checks.push({ code: "gemini_hello_probe_failed", level: "info", message: "Gemini hello probe exited with non-zero code.", ...(detail ? { detail } : {}) });
      }
    } catch {
      checks.push({ code: "gemini_hello_probe_error", level: "info", message: "Gemini hello probe could not run." });
    }
  }

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
