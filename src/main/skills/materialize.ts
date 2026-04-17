import { existsSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { FileInventoryEntry } from "../skill-types.js";
import { MAX_SKILL_BYTES } from "../skill-github.js";

export async function materializeSkillFiles(
  dir: string,
  markdown: string,
  _inventory: FileInventoryEntry[],
): Promise<string> {
  if (markdown.length * 2 > MAX_SKILL_BYTES) {
    throw new Error(`SKILL.md exceeds ${MAX_SKILL_BYTES}-byte limit`);
  }
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), markdown, "utf-8");
  return dir;
}

export async function cleanupSkillFilesDir(dir: string): Promise<void> {
  if (existsSync(dir)) {
    await rm(dir, { recursive: true, force: true });
  }
}
