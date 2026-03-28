// ---------------------------------------------------------------------------
// Claude adapter skill listing / sync -- ephemeral mode
// Skills are mounted into a temp dir via --add-dir at run time, not persisted.
// ---------------------------------------------------------------------------

import path from "node:path";
import type {
  AdapterSkillContext,
  AdapterSkillEntry,
  AdapterSkillSnapshot,
} from "@agentcompany/adapter-utils";
import {
  parseObject,
  asString,
  readAgentCompanyRuntimeSkillEntries,
  readInstalledSkillTargets,
  resolveAgentCompanyDesiredSkillNames,
} from "@agentcompany/adapter-utils/server-utils";

function resolveClaudeSkillsHome(config: Record<string, unknown>): string {
  const env = parseObject(config.env);
  const home = asString(env.HOME, asString(env.USERPROFILE, ""));
  const base = home || (process.env.HOME ?? process.env.USERPROFILE ?? "");
  return path.join(base, ".claude", "skills");
}

async function buildClaudeSkillSnapshot(
  config: Record<string, unknown>,
): Promise<AdapterSkillSnapshot> {
  const moduleDir = path.resolve(import.meta.dirname ?? __dirname);
  const availableEntries = await readAgentCompanyRuntimeSkillEntries(config, moduleDir);
  const desiredSkills = resolveAgentCompanyDesiredSkillNames(config, availableEntries);
  const desiredSet = new Set(desiredSkills);
  const entries: AdapterSkillEntry[] = [];
  const warnings: string[] = [];

  for (const available of availableEntries) {
    const desired = desiredSet.has(available.key);
    entries.push({
      key: available.key,
      runtimeName: available.runtimeName,
      desired,
      managed: true,
      state: desired ? "configured" : "available",
      sourcePath: available.source,
      targetPath: null,
      detail: desired
        ? "Will be mounted into the ephemeral Claude skill directory on the next run."
        : null,
      required: Boolean(available.required),
      requiredReason: available.requiredReason ?? null,
      origin: available.required ? "paperclip_required" : "company_managed",
      originLabel: available.required ? "Required by AgentCompany" : "Managed by AgentCompany",
      readOnly: false,
    });
  }

  // Scan installed Claude skills for external entries
  const skillsHome = resolveClaudeSkillsHome(config);
  const installed = await readInstalledSkillTargets(skillsHome);
  for (const [name, installedEntry] of installed.entries()) {
    if (availableEntries.some((entry) => entry.runtimeName === name)) continue;
    entries.push({
      key: name,
      runtimeName: name,
      desired: false,
      managed: false,
      state: "external",
      origin: "user_installed",
      originLabel: "User-installed",
      locationLabel: "~/.claude/skills",
      readOnly: true,
      sourcePath: null,
      targetPath: installedEntry.targetPath ?? path.join(skillsHome, name),
      detail: "Installed outside AgentCompany management.",
    });
  }

  // Check for desired skills not in available
  for (const desiredSkill of desiredSkills) {
    if (availableEntries.some((entry) => entry.key === desiredSkill)) continue;
    if (entries.some((entry) => entry.key === desiredSkill)) continue;
    warnings.push(`Desired skill "${desiredSkill}" is not available from the AgentCompany skills directory.`);
    entries.push({
      key: desiredSkill,
      runtimeName: null,
      desired: true,
      managed: true,
      state: "missing",
      sourcePath: null,
      targetPath: null,
      detail: "AgentCompany cannot find this skill in the local runtime skills directory.",
      origin: "external_unknown",
      originLabel: "External or unavailable",
      readOnly: false,
    });
  }

  entries.sort((left, right) => left.key.localeCompare(right.key));

  return {
    adapterType: "claude_local",
    supported: true,
    mode: "ephemeral",
    desiredSkills,
    entries,
    warnings,
  };
}

/**
 * List the current skill state for the Claude adapter.
 * Ephemeral mode: skills are injected at run time via --add-dir, not persisted.
 */
export async function listClaudeSkills(
  ctx: AdapterSkillContext,
): Promise<AdapterSkillSnapshot> {
  return buildClaudeSkillSnapshot(ctx.config);
}

/**
 * Sync skills for the Claude adapter.
 * Ephemeral mode: no on-disk sync needed; skills are injected at run time.
 * Returns the current snapshot for informational purposes.
 */
export async function syncClaudeSkills(
  ctx: AdapterSkillContext,
  _desiredSkills: string[],
): Promise<AdapterSkillSnapshot> {
  return buildClaudeSkillSnapshot(ctx.config);
}
