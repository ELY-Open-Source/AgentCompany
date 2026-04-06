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
import fs from "node:fs/promises";

export {
  hasNonEmptyEnvValue,
  parseManagedSkills,
  parseExtraArgs,
  buildCommonAgentCompanyEnv,
  resolveSessionResumeState,
};

export const SKILLS_CANDIDATES = buildSkillsCandidates(import.meta.url);

export const CODEX_ROLLOUT_NOISE_RE =
  /^\d{4}-\d{2}-\d{2}T[^\s]+\s+ERROR\s+codex_core::rollout::list:\s+state db missing rollout path for thread\s+[a-z0-9-]+$/i;

export function stripCodexRolloutNoise(text: string): string {
  const parts = text.split(/\r?\n/);
  const kept: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) {
      kept.push(part);
      continue;
    }
    if (CODEX_ROLLOUT_NOISE_RE.test(trimmed)) continue;
    kept.push(part);
  }
  return kept.join("\n");
}

export function resolveCodexBillingType(env: Record<string, string>): "api" | "subscription" {
  return hasNonEmptyEnvValue(env, "OPENAI_API_KEY") ? "api" : "subscription";
}

export function codexHomeDir(): string {
  const fromEnv = process.env.CODEX_HOME;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return fromEnv.trim();
  return path.join(os.homedir(), ".codex");
}

export async function resolveAgentCompanySkillsDir(): Promise<string | null> {
  return resolveSkillsDir(SKILLS_CANDIDATES);
}

export async function ensureCodexSkillsInjected(
  managedSkills: ManagedSkillRef[],
  onLog: AdapterExecutionContext["onLog"],
) {
  const skillsHome = path.join(codexHomeDir(), "skills");

  if (managedSkills.length > 0) {
    await createManagedSkillSymlinks(managedSkills, skillsHome, onLog);
    return;
  }

  const skillsDir = await resolveSkillsDir(SKILLS_CANDIDATES);
  if (!skillsDir) return;

  await fs.mkdir(skillsHome, { recursive: true });
  const entries = await fs.readdir(skillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const source = path.join(skillsDir, entry.name);
    const target = path.join(skillsHome, entry.name);
    const existing = await fs.lstat(target).catch(() => null);
    if (existing) continue;

    try {
      await fs.symlink(source, target);
      await onLog(
        "stderr",
        `[agent-company] Injected Codex skill "${entry.name}" into ${skillsHome}\n`,
      );
    } catch (err) {
      await onLog(
        "stderr",
        `[agent-company] Failed to inject Codex skill "${entry.name}" into ${skillsHome}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
}
