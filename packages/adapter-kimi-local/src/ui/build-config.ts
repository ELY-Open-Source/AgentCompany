import type { CreateConfigValues } from "@agentcompany/adapter-utils";
import { parseCommaArgs, parseEnvVars, parseEnvBindings } from "@agentcompany/adapter-utils/config-utils";
import { DEFAULT_KIMI_LOCAL_MODEL } from "../index.js";

export function buildKimiLocalConfig(v: CreateConfigValues): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (v.cwd) config.cwd = v.cwd;
  if (v.promptTemplate) config.promptTemplate = v.promptTemplate;
  config.model = v.model || DEFAULT_KIMI_LOCAL_MODEL;
  config.timeoutSec = 0;
  config.graceSec = 20;
  const env = parseEnvBindings(v.envBindings);
  const legacy = parseEnvVars(v.envVars);
  for (const [key, value] of Object.entries(legacy)) {
    if (!Object.prototype.hasOwnProperty.call(env, key)) {
      env[key] = { type: "plain", value };
    }
  }
  if (Object.keys(env).length > 0) config.env = env;
  if (v.command) config.command = v.command;
  if (v.extraArgs) config.extraArgs = parseCommaArgs(v.extraArgs);
  return config;
}
