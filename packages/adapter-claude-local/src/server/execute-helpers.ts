import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AdapterExecutionContext, ManagedSkillRef } from "@agentcompany/adapter-utils";
import type { RunProcessResult } from "@agentcompany/adapter-utils/server-utils";
import {
  asString,
  asNumber,
  ensureAbsoluteDirectory,
  ensureCommandResolvable,
  ensurePathInEnv,
  createManagedSkillSymlinks,
} from "@agentcompany/adapter-utils/server-utils";
import {
  hasNonEmptyEnvValue,
  buildSkillsCandidates,
  resolveSkillsDir,
  parseManagedSkills,
  parseExtraArgs,
  buildCommonAgentCompanyEnv,
  resolveSessionResumeState,
} from "@agentcompany/adapter-utils";

export {
  hasNonEmptyEnvValue,
  buildSkillsCandidates,
  resolveSkillsDir as resolveAgentCompanySkillsDir,
  parseManagedSkills,
  parseExtraArgs,
  buildCommonAgentCompanyEnv,
  resolveSessionResumeState,
};

export const SKILLS_CANDIDATES = buildSkillsCandidates(import.meta.url);

/**
 * Create a tmpdir with `.claude/skills/` containing symlinks to skills from
 * managed skill entries (preferred) or the repo's static `skills/` directory
 * (backward compatibility fallback), so `--add-dir` makes Claude Code discover
 * them as proper registered skills.
 */
export async function buildSkillsDir(
  managedSkills: ManagedSkillRef[],
  onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void>,
): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agent-company-skills-"));
  const target = path.join(tmp, ".claude", "skills");
  await fs.mkdir(target, { recursive: true });

  if (managedSkills.length > 0) {
    await createManagedSkillSymlinks(managedSkills, target, onLog);
    return tmp;
  }

  const skillsDir = await resolveSkillsDir(SKILLS_CANDIDATES);
  if (!skillsDir) return tmp;
  const entries = await fs.readdir(skillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await fs.symlink(
        path.join(skillsDir, entry.name),
        path.join(target, entry.name),
      );
    }
  }
  return tmp;
}

export interface ClaudeExecutionInput {
  runId: string;
  agent: AdapterExecutionContext["agent"];
  config: Record<string, unknown>;
  context: Record<string, unknown>;
  authToken?: string;
}

export interface ClaudeRuntimeConfig {
  command: string;
  cwd: string;
  workspaceId: string | null;
  workspaceRepoUrl: string | null;
  workspaceRepoRef: string | null;
  env: Record<string, string>;
  timeoutSec: number;
  graceSec: number;
  extraArgs: string[];
}

export function buildLoginResult(input: {
  proc: RunProcessResult;
  loginUrl: string | null;
}) {
  return {
    exitCode: input.proc.exitCode,
    signal: input.proc.signal,
    timedOut: input.proc.timedOut,
    stdout: input.proc.stdout,
    stderr: input.proc.stderr,
    loginUrl: input.loginUrl,
  };
}

export function resolveClaudeBillingType(env: Record<string, string>): "api" | "subscription" {
  return hasNonEmptyEnvValue(env, "ANTHROPIC_API_KEY") ? "api" : "subscription";
}

export async function buildClaudeRuntimeConfig(input: ClaudeExecutionInput): Promise<ClaudeRuntimeConfig> {
  const { runId, agent, config, context, authToken } = input;

  const command = asString(config.command, "claude");
  const { env, cwd, workspaceId, workspaceRepoUrl, workspaceRepoRef } = await buildCommonAgentCompanyEnv(
    { runId, agent, config, context, authToken },
    { ensureAbsoluteDirectory },
  );

  const runtimeEnv = ensurePathInEnv(env);
  await ensureCommandResolvable(command, cwd, runtimeEnv);

  const timeoutSec = asNumber(config.timeoutSec, 0);
  const graceSec = asNumber(config.graceSec, 20);
  const extraArgs = parseExtraArgs(config);

  return {
    command,
    cwd,
    workspaceId,
    workspaceRepoUrl,
    workspaceRepoRef,
    env,
    timeoutSec,
    graceSec,
    extraArgs,
  };
}
