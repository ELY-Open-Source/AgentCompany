import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import type { ManagedSkillRef } from "./types.js";
import { parseObject, asString, asBoolean } from "./server-utils-parsers.js";

/**
 * Create symlinks for managed skills in the target directory.
 * Per D-13: uses 'junction' type on Windows to avoid Developer Mode requirement.
 * Individual skill symlink failures are logged and reported but do not block other skills.
 */
export async function createManagedSkillSymlinks(
  managedSkills: ManagedSkillRef[],
  targetDir: string,
  onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void>,
): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true });
  const symlinkType = process.platform === "win32" ? ("junction" as const) : undefined;
  for (const skill of managedSkills) {
    const target = path.join(targetDir, skill.runtimeName);
    const existing = await fs.lstat(target).catch(() => null);
    if (existing) {
      await fs.rm(target, { recursive: true, force: true });
    }
    try {
      await fs.symlink(skill.sourcePath, target, symlinkType);
      await onLog("stderr", `[agent-company] Injected managed skill "${skill.runtimeName}"\n`);
    } catch (err) {
      await onLog(
        "stderr",
        `[agent-company] Failed to inject skill "${skill.runtimeName}": ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Skill resolution helpers -- ported from Paperclip reference with
// AgentCompany naming. These utilities let each adapter discover, list,
// resolve, and synchronize skills from a shared skills directory.
// ---------------------------------------------------------------------------

export const AGENTCOMPANY_SKILL_ROOT_RELATIVE_CANDIDATES = [
  "../../skills",
  "../../../../../skills",
];

export interface AgentCompanySkillEntry {
  key: string;
  runtimeName: string;
  source: string;
  required?: boolean;
  requiredReason?: string | null;
}

export interface InstalledSkillTarget {
  targetPath: string | null;
  kind: "symlink" | "directory" | "file";
}

export function resolveInstalledEntryTarget(
  skillsHome: string,
  entryName: string,
  dirent: Dirent,
  linkedPath: string | null,
): InstalledSkillTarget {
  const fullPath = path.join(skillsHome, entryName);
  if (dirent.isSymbolicLink()) {
    return {
      targetPath: linkedPath ? path.resolve(path.dirname(fullPath), linkedPath) : null,
      kind: "symlink",
    };
  }
  if (dirent.isDirectory()) {
    return { targetPath: fullPath, kind: "directory" };
  }
  return { targetPath: fullPath, kind: "file" };
}

export function normalizeConfiguredAgentCompanyRuntimeSkills(value: unknown): AgentCompanySkillEntry[] {
  if (!Array.isArray(value)) return [];
  const out: AgentCompanySkillEntry[] = [];
  for (const rawEntry of value) {
    const entry = parseObject(rawEntry);
    const key = asString(entry.key, asString(entry.name, "")).trim();
    const runtimeName = asString(entry.runtimeName, asString(entry.name, "")).trim();
    const source = asString(entry.source, "").trim();
    if (!key || !runtimeName || !source) continue;
    out.push({
      key,
      runtimeName,
      source,
      required: asBoolean(entry.required, false),
      requiredReason:
        typeof entry.requiredReason === "string" && entry.requiredReason.trim().length > 0
          ? entry.requiredReason.trim()
          : null,
    });
  }
  return out;
}

/**
 * Resolve the AgentCompany skills root directory from relative path candidates.
 */
export async function resolveAgentCompanySkillsDir(
  moduleDir: string,
  additionalCandidates: string[] = [],
): Promise<string | null> {
  const candidates = [
    ...AGENTCOMPANY_SKILL_ROOT_RELATIVE_CANDIDATES.map((relativePath) => path.resolve(moduleDir, relativePath)),
    ...additionalCandidates.map((candidate) => path.resolve(candidate)),
  ];
  const seenRoots = new Set<string>();

  for (const root of candidates) {
    if (seenRoots.has(root)) continue;
    seenRoots.add(root);
    const isDirectory = await fs.stat(root).then((stats) => stats.isDirectory()).catch(() => false);
    if (isDirectory) return root;
  }

  return null;
}

/**
 * List skill entries from the AgentCompany skills directory.
 */
export async function listAgentCompanySkillEntries(
  moduleDir: string,
  additionalCandidates: string[] = [],
): Promise<AgentCompanySkillEntry[]> {
  const root = await resolveAgentCompanySkillsDir(moduleDir, additionalCandidates);
  if (!root) return [];

  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        key: `agentcompany/agentcompany/${entry.name}`,
        runtimeName: entry.name,
        source: path.join(root, entry.name),
        required: true,
        requiredReason: "Bundled AgentCompany skills are always available for local adapters.",
      }));
  } catch {
    return [];
  }
}

/**
 * Read installed skill targets from a skill home directory (symlinks, dirs, files).
 */
export async function readInstalledSkillTargets(skillsHome: string): Promise<Map<string, InstalledSkillTarget>> {
  const entries = await fs.readdir(skillsHome, { withFileTypes: true }).catch(() => []);
  const out = new Map<string, InstalledSkillTarget>();
  for (const entry of entries) {
    const fullPath = path.join(skillsHome, entry.name);
    const linkedPath = entry.isSymbolicLink() ? await fs.readlink(fullPath).catch(() => null) : null;
    out.set(entry.name, resolveInstalledEntryTarget(skillsHome, entry.name, entry, linkedPath));
  }
  return out;
}

/**
 * Read runtime skill entries from adapter config or discover from module directory.
 */
export async function readAgentCompanyRuntimeSkillEntries(
  config: Record<string, unknown>,
  moduleDir: string,
  additionalCandidates: string[] = [],
): Promise<AgentCompanySkillEntry[]> {
  const configuredEntries = normalizeConfiguredAgentCompanyRuntimeSkills(config.agentCompanyRuntimeSkills);
  if (configuredEntries.length > 0) return configuredEntries;
  return listAgentCompanySkillEntries(moduleDir, additionalCandidates);
}
