// ---------------------------------------------------------------------------
// Gemini adapter skill listing / sync -- persistent mode
// Skills are symlinked into ~/.gemini/skills/ and persist across runs.
// ---------------------------------------------------------------------------

import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  AdapterSkillContext,
  AdapterSkillSnapshot,
} from "@agentcompany/adapter-utils";
import {
  parseObject,
  asString,
  readAgentCompanyRuntimeSkillEntries,
  readInstalledSkillTargets,
  resolveAgentCompanyDesiredSkillNames,
  buildPersistentSkillSnapshot,
  ensureAgentCompanySkillSymlink,
  removeMaintainerOnlySkillSymlinks,
} from "@agentcompany/adapter-utils/server-utils";

function resolveGeminiSkillsHome(config: Record<string, unknown>): string {
  const env = parseObject(config.env);
  const home = asString(env.HOME, asString(env.USERPROFILE, ""));
  const base = home || (process.env.HOME ?? process.env.USERPROFILE ?? "");
  return path.join(base, ".gemini", "skills");
}

async function buildGeminiSkillSnapshot(
  config: Record<string, unknown>,
): Promise<AdapterSkillSnapshot> {
  const moduleDir = path.resolve(import.meta.dirname ?? __dirname);
  const availableEntries = await readAgentCompanyRuntimeSkillEntries(config, moduleDir);
  const desiredSkills = resolveAgentCompanyDesiredSkillNames(config, availableEntries);
  const skillsHome = resolveGeminiSkillsHome(config);
  const installed = await readInstalledSkillTargets(skillsHome);

  return buildPersistentSkillSnapshot({
    adapterType: "gemini_local",
    availableEntries,
    desiredSkills,
    installed,
    skillsHome,
    locationLabel: "~/.gemini/skills",
    missingDetail: "Configured but not currently linked into the Gemini skills home.",
    externalConflictDetail: "Skill name is occupied by an external installation.",
    externalDetail: "Installed outside AgentCompany management.",
  });
}

/**
 * List the current skill state for the Gemini adapter.
 * Persistent mode: reports actual installed state in ~/.gemini/skills/.
 */
export async function listGeminiSkills(
  ctx: AdapterSkillContext,
): Promise<AdapterSkillSnapshot> {
  return buildGeminiSkillSnapshot(ctx.config);
}

/**
 * Sync skills for the Gemini adapter.
 * Persistent mode: creates symlinks for desired skills, removes stale ones,
 * then returns a fresh snapshot.
 */
export async function syncGeminiSkills(
  ctx: AdapterSkillContext,
  desiredSkills: string[],
): Promise<AdapterSkillSnapshot> {
  const moduleDir = path.resolve(import.meta.dirname ?? __dirname);
  const config = ctx.config;
  const availableEntries = await readAgentCompanyRuntimeSkillEntries(config, moduleDir);
  const skillsHome = resolveGeminiSkillsHome(config);

  // Ensure the skills home directory exists
  await fs.mkdir(skillsHome, { recursive: true });

  // Build a set of desired skill keys for quick lookup
  const desiredSet = new Set(desiredSkills);

  // Symlink type for Windows compatibility
  const symlinkType = process.platform === "win32" ? ("junction" as const) : undefined;
  const linkSkill = async (source: string, target: string) => {
    await fs.symlink(source, target, symlinkType);
  };

  // Create/repair symlinks for desired skills
  const syncedRuntimeNames = new Set<string>();
  for (const available of availableEntries) {
    if (!desiredSet.has(available.key)) continue;
    const target = path.join(skillsHome, available.runtimeName);
    await ensureAgentCompanySkillSymlink(available.source, target, linkSkill);
    syncedRuntimeNames.add(available.runtimeName);
  }

  // Remove stale maintainer-only symlinks that are no longer desired
  await removeMaintainerOnlySkillSymlinks(skillsHome, syncedRuntimeNames);

  // Return fresh snapshot reflecting the new state
  const installed = await readInstalledSkillTargets(skillsHome);
  return buildPersistentSkillSnapshot({
    adapterType: "gemini_local",
    availableEntries,
    desiredSkills,
    installed,
    skillsHome,
    locationLabel: "~/.gemini/skills",
    missingDetail: "Configured but not currently linked into the Gemini skills home.",
    externalConflictDetail: "Skill name is occupied by an external installation.",
    externalDetail: "Installed outside AgentCompany management.",
  });
}
