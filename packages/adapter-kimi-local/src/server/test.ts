import type {
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@agentcompany/adapter-utils";
import {
  asString,
  ensureCommandResolvable,
  ensurePathInEnv,
} from "@agentcompany/adapter-utils/server-utils";
import { normalizeEnv } from "@agentcompany/adapter-utils/test-utils";

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const command = asString(ctx.config.command, "kimi");
  const cwd = asString(ctx.config.cwd, process.cwd());
  const env = normalizeEnv(ensurePathInEnv(normalizeEnv(ctx.config.env)));

  try {
    await ensureCommandResolvable(command, cwd, env);
    return {
      adapterType: "kimi_local",
      status: "pass",
      checks: [
        {
          code: "kimi_command_detected",
          level: "info",
          message: `Detected Kimi Code command "${command}".`,
        },
      ],
      testedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      adapterType: "kimi_local",
      status: "fail",
      checks: [
        {
          code: "kimi_command_missing",
          level: "error",
          message: error instanceof Error ? error.message : "Kimi command is not available.",
          hint: "Install Kimi Code with `curl -L code.kimi.com/install.sh | bash` and ensure the CLI is available on PATH.",
        },
      ],
      testedAt: new Date().toISOString(),
    };
  }
}
