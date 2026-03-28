// ---------------------------------------------------------------------------
// Codex adapter skill listing / sync -- ephemeral mode
// Skills are linked into the workspace .agents/skills directory at run time.
// ---------------------------------------------------------------------------

import path from "node:path";
import type {
  AdapterSkillContext,
  AdapterSkillEntry,
  AdapterSkillSnapshot,
} from "@agentcompany/adapter-utils";
import {
  readAgentCompanyRuntimeSkillEntries,
  resolveAgentCompanyDesiredSkillNames,
} from "@agentcompany/adapter-utils/server-utils";

async function buildCodexSkillSnapshot(
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
        ? "Will be linked into the workspace .agents/skills directory on the next run."
        : null,
      required: Boolean(available.required),
      requiredReason: available.requiredReason ?? null,
      origin: available.required ? "paperclip_required" : "company_managed",
      originLabel: available.required ? "Required by AgentCompany" : "Managed by AgentCompany",
      readOnly: false,
    });
  }

  // Check for desired skills not in available
  for (const desiredSkill of desiredSkills) {
    if (availableEntries.some((entry) => entry.key === desiredSkill)) continue;
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
    adapterType: "codex_local",
    supported: true,
    mode: "ephemeral",
    desiredSkills,
    entries,
    warnings,
  };
}

/**
 * List the current skill state for the Codex adapter.
 * Ephemeral mode: skills are linked into workspace at run time.
 */
export async function listCodexSkills(
  ctx: AdapterSkillContext,
): Promise<AdapterSkillSnapshot> {
  return buildCodexSkillSnapshot(ctx.config);
}

/**
 * Sync skills for the Codex adapter.
 * Ephemeral mode: no on-disk sync needed; skills are linked at run time.
 * Returns the current snapshot for informational purposes.
 */
export async function syncCodexSkills(
  ctx: AdapterSkillContext,
  _desiredSkills: string[],
): Promise<AdapterSkillSnapshot> {
  return buildCodexSkillSnapshot(ctx.config);
}
