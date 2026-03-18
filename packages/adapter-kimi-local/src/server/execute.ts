import type { AdapterExecutionContext, AdapterExecutionResult } from "@agentcompany/adapter-utils";
import {
  asNumber,
  asString,
  asStringArray,
  ensureAbsoluteDirectory,
  ensureCommandResolvable,
  ensurePathInEnv,
  runChildProcess,
} from "@agentcompany/adapter-utils/server-utils";
import { DEFAULT_KIMI_LOCAL_MODEL } from "../index.js";

function normalizeEnv(input: unknown): Record<string, string> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {};
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, config, context, onLog } = ctx;
  const command = asString(config.command, "kimi");
  const cwd = asString(config.cwd, process.cwd());
  const model = asString(config.model, DEFAULT_KIMI_LOCAL_MODEL);
  const timeoutSec = asNumber(config.timeoutSec, 0);
  const graceSec = asNumber(config.graceSec, 20);
  const extraArgs = asStringArray(config.extraArgs);

  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });

  const prompt = typeof context.taskTitle === "string" && context.taskTitle.length > 0
    ? [
        context.taskTitle,
        typeof context.taskDescription === "string" && context.taskDescription.length > 0
          ? context.taskDescription
          : "",
      ].filter(Boolean).join("\n\n")
    : [
        `You are agent ${ctx.agent.name}.`,
        "Respond with a concise execution summary when complete.",
      ].join("\n\n");

  const env = normalizeEnv(ensurePathInEnv(normalizeEnv(config.env)));
  await ensureCommandResolvable(command, cwd, env);

  const result = await runChildProcess(runId, command, extraArgs, {
    cwd,
    env,
    timeoutSec,
    graceSec,
    stdin: prompt,
    onLog,
  });

  const summary =
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-8)
      .join("\n") || null;

  return {
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    summary,
    model,
    billingType: "unknown",
  };
}
