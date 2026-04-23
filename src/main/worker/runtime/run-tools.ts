import { createCodingTools, type BashToolOptions } from "@mariozechner/pi-coding-agent";
import type { AgentState } from "@mariozechner/pi-agent-core";

type ErasedAgentTool = AgentState["tools"][number];

export function mergeRunEnvs(
  jobEnv: Record<string, string>,
  preparedEnv: Record<string, string>,
): Record<string, string> {
  return { ...jobEnv, ...preparedEnv };
}

export function createRunScopedBashOptions(
  runEnv: Record<string, string>,
): BashToolOptions {
  const envSnapshot = { ...runEnv };
  return {
    spawnHook: (context) => ({
      ...context,
      env: {
        ...context.env,
        ...envSnapshot,
      },
    }),
  };
}

export function createRunScopedCodingTools(
  cwd: string,
  runEnv: Record<string, string>,
): ErasedAgentTool[] {
  return createCodingTools(cwd, {
    bash: createRunScopedBashOptions(runEnv),
  }) as ErasedAgentTool[];
}
