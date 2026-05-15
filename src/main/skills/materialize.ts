import { existsSync } from "node:fs";
import { mkdir, rename, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { FileInventoryEntry } from "../skill-types.js";
import { MAX_SKILL_BYTES, MAX_SKILL_FILE_BYTES, MAX_TOTAL_BYTES } from "../skill-github.js";

export interface MaterializedSkillFile extends FileInventoryEntry {
  content: string | Uint8Array;
}

interface PreparedSkillFile extends FileInventoryEntry {
  content: Uint8Array;
}

const MATERIALIZED_FILE_MODE = 0o600;
const MATERIALIZED_SCRIPT_MODE = 0o700;
const MATERIALIZED_DIR_MODE = 0o700;

export function normalizeMaterializedRelativePath(filePath: string): string {
  if (filePath.includes("\0")) {
    throw new Error("Skill file path contains a null byte");
  }
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized !== filePath) {
    throw new Error(`Skill file path must use POSIX separators: ${filePath}`);
  }
  if (normalized.length === 0 || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`Skill file path must be relative: ${filePath}`);
  }
  const parts = normalized.split("/");
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    throw new Error(`Skill file path contains traversal segments: ${filePath}`);
  }
  return parts.join("/");
}

function encodeContent(content: string | Uint8Array): Uint8Array {
  if (typeof content === "string") {
    return Buffer.from(content, "utf-8");
  }
  return content;
}

function ensureTargetInsideRoot(rootDir: string, targetPath: string, relativePath: string): void {
  const root = resolve(rootDir);
  const targetRelative = relative(root, targetPath);
  if (targetRelative.length === 0 || targetRelative.startsWith("..") || isAbsolute(targetRelative)) {
    throw new Error(`Skill file path escapes materialization root: ${relativePath}`);
  }
}

function prepareMaterializedFiles(files: MaterializedSkillFile[]): PreparedSkillFile[] {
  const seen = new Set<string>();
  const prepared: PreparedSkillFile[] = [];
  let totalBytes = 0;
  let hasRootSkill = false;

  for (const file of files) {
    const path = normalizeMaterializedRelativePath(file.path);
    const duplicateKey = process.platform === "win32" ? path.toLowerCase() : path;
    if (seen.has(duplicateKey)) {
      throw new Error(`Duplicate skill file path: ${path}`);
    }
    seen.add(duplicateKey);

    const content = encodeContent(file.content);
    const maxBytes = path === "SKILL.md" ? MAX_SKILL_BYTES : MAX_SKILL_FILE_BYTES;
    if (content.byteLength > maxBytes) {
      throw new Error(`${path} exceeds ${maxBytes}-byte limit`);
    }
    totalBytes += content.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error(`Skill package exceeded aggregate limit of ${MAX_TOTAL_BYTES} bytes`);
    }
    if (path === "SKILL.md") {
      hasRootSkill = true;
    }
    prepared.push({ path, kind: file.kind, content });
  }

  if (!hasRootSkill) {
    throw new Error("Skill package is missing SKILL.md");
  }
  return prepared;
}

async function replaceDirectoryWithFiles(dir: string, files: PreparedSkillFile[]): Promise<void> {
  const parentDir = dirname(dir);
  const dirName = basename(dir);
  const stagingDir = join(parentDir, `.${dirName}.${randomUUID()}.tmp`);
  let backupDir: string | null = null;

  await mkdir(parentDir, { recursive: true, mode: MATERIALIZED_DIR_MODE });
  await mkdir(stagingDir, { recursive: true, mode: MATERIALIZED_DIR_MODE });

  try {
    for (const file of files) {
      const target = resolve(stagingDir, ...file.path.split("/"));
      ensureTargetInsideRoot(stagingDir, target, file.path);
      await mkdir(dirname(target), { recursive: true, mode: MATERIALIZED_DIR_MODE });
      await writeFile(target, file.content, {
        mode: file.kind === "script" ? MATERIALIZED_SCRIPT_MODE : MATERIALIZED_FILE_MODE,
      });
    }

    if (existsSync(dir)) {
      backupDir = join(parentDir, `.${dirName}.${randomUUID()}.old`);
      await rename(dir, backupDir);
    }

    try {
      await rename(stagingDir, dir);
    } catch (error) {
      if (backupDir && existsSync(backupDir)) {
        await rename(backupDir, dir);
        backupDir = null;
      }
      throw error;
    }

    if (backupDir) {
      await rm(backupDir, { recursive: true, force: true });
      backupDir = null;
    }
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
    if (backupDir) {
      await rm(backupDir, { recursive: true, force: true });
    }
  }
}

export async function materializeSkillFiles(
  dir: string,
  files: MaterializedSkillFile[],
): Promise<string> {
  const prepared = prepareMaterializedFiles(files);
  await replaceDirectoryWithFiles(dir, prepared);
  return dir;
}

export async function cleanupSkillFilesDir(dir: string): Promise<void> {
  if (existsSync(dir)) {
    await rm(dir, { recursive: true, force: true });
  }
}
