import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AdapterExecutionContext, ManagedSkillRef } from "@agentcompany/adapter-utils";
import {
  hasNonEmptyEnvValue,
  buildSkillsCandidates,
  resolveSkillsDir,
  parseManagedSkills,
  parseExtraArgs,
  buildCommonAgentCompanyEnv,
  resolveSessionResumeState,
} from "@agentcompany/adapter-utils";
import {
  createManagedSkillSymlinks,
} from "@agentcompany/adapter-utils/server-utils";

export {
  hasNonEmptyEnvValue,
  parseManagedSkills,
  parseExtraArgs,
  buildCommonAgentCompanyEnv,
  resolveSessionResumeState,
};

export const SKILLS_CANDIDATES = buildSkillsCandidates(import.meta.url);

export function resolveGeminiBillingType(env: Record<string, string>): "api" | "subscription" {
  return hasNonEmptyEnvValue(env, "GEMINI_API_KEY") || hasNonEmptyEnvValue(env, "GOOGLE_API_KEY")
    ? "api"
    : "subscription";
}

export function renderEnvNote(env: Record<string, string>): string {
  const agentCompanyKeys = Object.keys(env)
    .filter((key) => key.startsWith("AGENT_COMPANY_"))
    .sort();
  if (agentCompanyKeys.length === 0) return "";
  return [
    "Runtime note:",
    `The following AGENT_COMPANY_* environment variables are available in this run: ${agentCompanyKeys.join(", ")}`,
    "Do not assume these variables are missing without checking your shell environment.",
    "",
    "",
  ].join("\n");
}

export function renderApiAccessNote(env: Record<string, string>): string {
  if (!hasNonEmptyEnvValue(env, "AGENT_COMPANY_API_URL") || !hasNonEmptyEnvValue(env, "AGENT_COMPANY_API_KEY")) return "";
  return [
    "API access note:",
    "Use run_shell_command with curl to make API requests.",
    "GET example:",
    `  run_shell_command({ command: "curl -s -H \\"Authorization: Bearer $AGENT_COMPANY_API_KEY\\" \\"$AGENT_COMPANY_API_URL/api/agents/me\\"" })`,
    "POST/PATCH example:",
    `  run_shell_command({ command: "curl -s -X POST -H \\"Authorization: Bearer $AGENT_COMPANY_API_KEY\\" -H 'Content-Type: application/json' -H \\"X-Agent-Company-Run-Id: $AGENT_COMPANY_RUN_ID\\" -d '{...}' \\"$AGENT_COMPANY_API_URL/api/issues/{id}/checkout\\"" })`,
    "",
    "",
  ].join("\n");
}

export async function resolveAgentCompanySkillsDir(): Promise<string | null> {
  return resolveSkillsDir(SKILLS_CANDIDATES);
}

export function geminiSkillsHome(): string {
  return path.join(os.homedir(), ".gemini", "skills");
}

/**
 * Inject AgentCompany skills directly into `~/.gemini/skills/` via symlinks.
 * Uses managed skills when available; falls back to static repo scan.
 */
export async function ensureGeminiSkillsInjected(
  managedSkills: ManagedSkillRef[],
  onLog: AdapterExecutionContext["onLog"],
): Promise<void> {
  const skillsHome = geminiSkillsHome();

  if (managedSkills.length > 0) {
    await createManagedSkillSymlinks(managedSkills, skillsHome, onLog);
    return;
  }

  const skillsDir = await resolveSkillsDir(SKILLS_CANDIDATES);
  if (!skillsDir) return;

  try {
    await fs.mkdir(skillsHome, { recursive: true });
  } catch (err) {
    await onLog(
      "stderr",
      `[agent-company] Failed to prepare Gemini skills directory ${skillsHome}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return;
  }

  let entries: Dirent[];
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch (err) {
    await onLog(
      "stderr",
      `[agent-company] Failed to read AgentCompany skills from ${skillsDir}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const source = path.join(skillsDir, entry.name);
    const target = path.join(skillsHome, entry.name);
    const existing = await fs.lstat(target).catch(() => null);
    if (existing) continue;

    try {
      await fs.symlink(source, target);
      await onLog("stderr", `[agent-company] Linked Gemini skill: ${entry.name}\n`);
    } catch (err) {
      await onLog(
        "stderr",
        `[agent-company] Failed to link Gemini skill "${entry.name}": ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
}
