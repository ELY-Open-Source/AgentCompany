import { readdirSync, realpathSync, statSync, type Dirent } from "node:fs";
import { join, resolve, relative } from "node:path";
import type { FileInventoryEntry } from "../skill-types.js";
import { classifyInventoryKind } from "../skill-format.js";

export const DEFAULT_SKILL_WALK_MAX_DEPTH = 8;
export const DEFAULT_SKILL_WALK_MAX_FILES = 256;

const BLOCKED_PATH_PREFIXES_UNIX = ["/etc", "/var", "/proc", "/sys", "/dev", "/boot", "/sbin", "/usr/sbin"];
const BLOCKED_PATH_PREFIXES_WIN = ["C:\\Windows", "C:\\Program Files", "C:\\ProgramData"];

export interface DiscoveryLogger {
  warn: (...args: unknown[]) => void;
}

export function assertNotSystemPath(realPath: string): void {
  const normalized = realPath.replace(/\\/g, "/");
  const blocked = process.platform === "win32" ? BLOCKED_PATH_PREFIXES_WIN : BLOCKED_PATH_PREFIXES_UNIX;
  for (const prefix of blocked) {
    const normalizedPrefix = prefix.replace(/\\/g, "/");
    if (normalized === normalizedPrefix || normalized.startsWith(normalizedPrefix + "/")) {
      throw new Error(`Importing skills from system directory is not allowed: ${realPath}`);
    }
  }
}

export function findSkillMdFiles(
  rootDir: string,
  logger: DiscoveryLogger,
  opts?: { maxDepth?: number; maxFiles?: number },
): string[] {
  const maxDepth = opts?.maxDepth ?? DEFAULT_SKILL_WALK_MAX_DEPTH;
  const maxFiles = opts?.maxFiles ?? DEFAULT_SKILL_WALK_MAX_FILES;
  const found: string[] = [];
  const visitedRealPaths = new Set<string>();
  let filesSeen = 0;

  function walk(dir: string, depth: number) {
    if (depth > maxDepth) {
      throw new Error(
        `Skill directory too deep, refusing to walk beyond ${maxDepth} levels`,
      );
    }
    let realDir: string;
    try {
      realDir = realpathSync(dir);
    } catch (err) {
      logger.warn(`[skill-import] realpathSync failed for ${dir}:`, err instanceof Error ? err.message : String(err));
      return;
    }
    if (visitedRealPaths.has(realDir)) {
      return;
    }
    visitedRealPaths.add(realDir);

    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      logger.warn(`[skill-import] readdirSync failed for ${dir}:`, err instanceof Error ? err.message : String(err));
      return;
    }
    for (const entry of entries) {
      filesSeen++;
      if (filesSeen > maxFiles) {
        throw new Error(
          `Skill directory contains too many files, refusing after ${maxFiles} entries`,
        );
      }
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.name === "SKILL.md") {
        found.push(fullPath);
      }
    }
  }
  walk(rootDir, 0);
  return found;
}

export function buildLocalInventory(
  skillDir: string,
  skillMdPath: string,
  logger: DiscoveryLogger,
  opts?: { maxDepth?: number; maxFiles?: number },
): FileInventoryEntry[] {
  const maxDepth = opts?.maxDepth ?? DEFAULT_SKILL_WALK_MAX_DEPTH;
  const maxFiles = opts?.maxFiles ?? DEFAULT_SKILL_WALK_MAX_FILES;
  const inventory: FileInventoryEntry[] = [
    { path: "SKILL.md", kind: "skill" },
  ];
  const visitedRealPaths = new Set<string>();
  let filesSeen = 0;

  function walk(dir: string, depth: number) {
    if (depth > maxDepth) {
      throw new Error(
        `Skill directory too deep, refusing to walk beyond ${maxDepth} levels`,
      );
    }
    let realDir: string;
    try {
      realDir = realpathSync(dir);
    } catch (err) {
      logger.warn(`[skill-import] realpathSync failed for ${dir}:`, err instanceof Error ? err.message : String(err));
      return;
    }
    if (visitedRealPaths.has(realDir)) {
      return;
    }
    visitedRealPaths.add(realDir);

    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      logger.warn(`[skill-import] readdirSync failed for ${dir}:`, err instanceof Error ? err.message : String(err));
      return;
    }
    for (const entry of entries) {
      filesSeen++;
      if (filesSeen > maxFiles) {
        throw new Error(
          `Skill directory contains too many files, refusing after ${maxFiles} entries`,
        );
      }
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const resolvedPath = resolve(fullPath);
      if (resolvedPath === skillMdPath) continue;
      let fileStat;
      try {
        fileStat = statSync(resolvedPath);
      } catch (err) {
        logger.warn(`[skill-import] statSync failed for ${resolvedPath}:`, err instanceof Error ? err.message : String(err));
        continue;
      }
      if (!fileStat.isFile()) continue;
      const relativePath = relative(skillDir, resolvedPath).replace(/\\/g, "/");
      inventory.push({
        path: relativePath,
        kind: (fileStat.mode & 0o111) !== 0 ? "script" : classifyInventoryKind(relativePath),
      });
    }
  }

  try {
    walk(skillDir, 0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("Skill directory too deep") || msg.startsWith("Skill directory contains too many files")) {
      throw err;
    }
  }
  return inventory;
}
