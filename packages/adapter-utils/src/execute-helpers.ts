import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import type { ManagedSkillRef } from "./types.js";
import { asString, asStringArray, parseObject } from "./server-utils-parsers.js";
import { buildAgentCompanyEnv } from "./server-utils-parsers.js";

// ---------------------------------------------------------------------------
// hasNonEmptyEnvValue
// ---------------------------------------------------------------------------

export function hasNonEmptyEnvValue(env: Record<string, string>, key: string): boolean {
  const raw = env[key];
  return typeof raw === "string" && raw.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Skills directory resolution
// ---------------------------------------------------------------------------

/**
 * Build the standard two-candidate list for a given adapter package.
 * `importMetaUrl` should be `import.meta.url` from the adapter's execute-helpers.ts.
 * - published: <pkg>/dist/server/ -> <pkg>/skills/
 * - dev:        src/server/ -> repo root/skills/
 */
export function buildSkillsCandidates(importMetaUrl: string): string[] {
  const moduleDir = path.dirname(fileURLToPath(importMetaUrl));
  return [
    path.resolve(moduleDir, "../../skills"),
    path.resolve(moduleDir, "../../../../../skills"),
  ];
}

/**
 * Resolve the first existing skills directory from the given candidates.
 */
export async function resolveSkillsDir(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    const isDir = await fs.stat(candidate).then((s) => s.isDirectory()).catch(() => false);
    if (isDir) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// ManagedSkills type guard + parser
// ---------------------------------------------------------------------------

export function parseManagedSkills(config: Record<string, unknown>): ManagedSkillRef[] {
  if (!Array.isArray(config.managedSkills)) return [];
  return (config.managedSkills as ManagedSkillRef[]).filter(
    (s) => typeof s.runtimeName === "string" && typeof s.sourcePath === "string",
  );
}

// ---------------------------------------------------------------------------
// extraArgs parser
// ---------------------------------------------------------------------------

export function parseExtraArgs(config: Record<string, unknown>): string[] {
  const fromExtraArgs = asStringArray(config.extraArgs);
  if (fromExtraArgs.length > 0) return fromExtraArgs;
  return asStringArray(config.args);
}

// ---------------------------------------------------------------------------
// Common env building
// ---------------------------------------------------------------------------

export interface CommonAgentCompanyEnvInput {
  runId: string;
  agent: { id: string; companyId: string };
  config: Record<string, unknown>;
  context: Record<string, unknown>;
  authToken?: string;
}

export interface CommonAgentCompanyEnvResult {
  env: Record<string, string>;
  cwd: string;
  effectiveWorkspaceCwd: string;
  workspaceId: string | null;
  workspaceRepoUrl: string | null;
  workspaceRepoRef: string | null;
  hasExplicitApiKey: boolean;
}

/**
 * Build the AGENT_COMPANY_* environment block common to all local adapters.
 * Returns the env map plus resolved workspace fields needed for session params.
 */
export async function buildCommonAgentCompanyEnv(
  input: CommonAgentCompanyEnvInput,
  opts: {
    ensureAbsoluteDirectory: (dir: string, options: { createIfMissing: boolean }) => Promise<void>;
  },
): Promise<CommonAgentCompanyEnvResult> {
  const { runId, agent, config, context, authToken } = input;

  const workspaceContext = parseObject(context.agentCompanyWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, "");
  const workspaceSource = asString(workspaceContext.source, "");
  const workspaceStrategy = asString(workspaceContext.strategy, "");
  const workspaceId = asString(workspaceContext.workspaceId, "") || null;
  const workspaceRepoUrl = asString(workspaceContext.repoUrl, "") || null;
  const workspaceRepoRef = asString(workspaceContext.repoRef, "") || null;
  const workspaceBranch = asString(workspaceContext.branchName, "") || null;
  const workspaceWorktreePath = asString(workspaceContext.worktreePath, "") || null;

  const workspaceHints = Array.isArray(context.agentCompanyWorkspaces)
    ? context.agentCompanyWorkspaces.filter(
        (value): value is Record<string, unknown> => typeof value === "object" && value !== null,
      )
    : [];
  const runtimeServiceIntents = Array.isArray(context.agentCompanyRuntimeServiceIntents)
    ? context.agentCompanyRuntimeServiceIntents.filter(
        (value): value is Record<string, unknown> => typeof value === "object" && value !== null,
      )
    : [];
  const runtimeServices = Array.isArray(context.agentCompanyRuntimeServices)
    ? context.agentCompanyRuntimeServices.filter(
        (value): value is Record<string, unknown> => typeof value === "object" && value !== null,
      )
    : [];
  const runtimePrimaryUrl = asString(context.agentCompanyRuntimePrimaryUrl as unknown, "");

  const configuredCwd = asString(config.cwd, "");
  const useConfiguredInsteadOfAgentHome = workspaceSource === "agent_home" && configuredCwd.length > 0;
  const effectiveWorkspaceCwd = useConfiguredInsteadOfAgentHome ? "" : workspaceCwd;
  const cwd = effectiveWorkspaceCwd || configuredCwd || process.cwd();
  await opts.ensureAbsoluteDirectory(cwd, { createIfMissing: true });

  const envConfig = parseObject(config.env);
  const hasExplicitApiKey =
    typeof envConfig.AGENT_COMPANY_API_KEY === "string" && envConfig.AGENT_COMPANY_API_KEY.trim().length > 0;

  const env: Record<string, string> = { ...buildAgentCompanyEnv(agent) };
  env.AGENT_COMPANY_RUN_ID = runId;

  const wakeTaskId =
    (typeof context.taskId === "string" && context.taskId.trim().length > 0 && context.taskId.trim()) ||
    (typeof context.issueId === "string" && context.issueId.trim().length > 0 && context.issueId.trim()) ||
    null;
  const wakeReason =
    typeof context.wakeReason === "string" && context.wakeReason.trim().length > 0
      ? context.wakeReason.trim()
      : null;
  const wakeCommentId =
    (typeof context.wakeCommentId === "string" && context.wakeCommentId.trim().length > 0 && context.wakeCommentId.trim()) ||
    (typeof context.commentId === "string" && context.commentId.trim().length > 0 && context.commentId.trim()) ||
    null;
  const approvalId =
    typeof context.approvalId === "string" && context.approvalId.trim().length > 0
      ? context.approvalId.trim()
      : null;
  const approvalStatus =
    typeof context.approvalStatus === "string" && context.approvalStatus.trim().length > 0
      ? context.approvalStatus.trim()
      : null;
  const linkedIssueIds = Array.isArray(context.issueIds)
    ? context.issueIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];

  if (wakeTaskId) env.AGENT_COMPANY_TASK_ID = wakeTaskId;
  if (wakeReason) env.AGENT_COMPANY_WAKE_REASON = wakeReason;
  if (wakeCommentId) env.AGENT_COMPANY_WAKE_COMMENT_ID = wakeCommentId;
  if (approvalId) env.AGENT_COMPANY_APPROVAL_ID = approvalId;
  if (approvalStatus) env.AGENT_COMPANY_APPROVAL_STATUS = approvalStatus;
  if (linkedIssueIds.length > 0) env.AGENT_COMPANY_LINKED_ISSUE_IDS = linkedIssueIds.join(",");

  if (effectiveWorkspaceCwd) env.AGENT_COMPANY_WORKSPACE_CWD = effectiveWorkspaceCwd;
  if (workspaceSource) env.AGENT_COMPANY_WORKSPACE_SOURCE = workspaceSource;
  if (workspaceStrategy) env.AGENT_COMPANY_WORKSPACE_STRATEGY = workspaceStrategy;
  if (workspaceId) env.AGENT_COMPANY_WORKSPACE_ID = workspaceId;
  if (workspaceRepoUrl) env.AGENT_COMPANY_WORKSPACE_REPO_URL = workspaceRepoUrl;
  if (workspaceRepoRef) env.AGENT_COMPANY_WORKSPACE_REPO_REF = workspaceRepoRef;
  if (workspaceBranch) env.AGENT_COMPANY_WORKSPACE_BRANCH = workspaceBranch;
  if (workspaceWorktreePath) env.AGENT_COMPANY_WORKSPACE_WORKTREE_PATH = workspaceWorktreePath;
  if (workspaceHints.length > 0) env.AGENT_COMPANY_WORKSPACES_JSON = JSON.stringify(workspaceHints);
  if (runtimeServiceIntents.length > 0) env.AGENT_COMPANY_RUNTIME_SERVICE_INTENTS_JSON = JSON.stringify(runtimeServiceIntents);
  if (runtimeServices.length > 0) env.AGENT_COMPANY_RUNTIME_SERVICES_JSON = JSON.stringify(runtimeServices);
  if (runtimePrimaryUrl) env.AGENT_COMPANY_RUNTIME_PRIMARY_URL = runtimePrimaryUrl;

  // Merge caller-configured env overrides
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }

  if (!hasExplicitApiKey && authToken) {
    env.AGENT_COMPANY_API_KEY = authToken;
  }

  return {
    env,
    cwd,
    effectiveWorkspaceCwd,
    workspaceId,
    workspaceRepoUrl,
    workspaceRepoRef,
    hasExplicitApiKey,
  };
}

// ---------------------------------------------------------------------------
// Session resume validation
// ---------------------------------------------------------------------------

export interface SessionResumeState {
  sessionId: string | null;
  runtimeSessionId: string;
  runtimeSessionCwd: string;
  canResumeSession: boolean;
}

export function resolveSessionResumeState(
  runtime: { sessionId?: string | null; sessionParams?: Record<string, unknown> | null },
  cwd: string,
): SessionResumeState {
  const runtimeSessionParams = parseObject(runtime.sessionParams);
  const runtimeSessionId = asString(runtimeSessionParams.sessionId, runtime.sessionId ?? "");
  const runtimeSessionCwd = asString(runtimeSessionParams.cwd, "");
  const canResumeSession =
    runtimeSessionId.length > 0 &&
    (runtimeSessionCwd.length === 0 || path.resolve(runtimeSessionCwd) === path.resolve(cwd));
  return {
    sessionId: canResumeSession ? runtimeSessionId : null,
    runtimeSessionId,
    runtimeSessionCwd,
    canResumeSession,
  };
}
