import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";

export interface CopiedSkillFile {
  relativePath: string;
  objectKey: string;
  sha256: string;
  sizeBytes: number;
}

export function copySkillRevision(sourceDir: string, artifactRoot: string, revisionId: string): CopiedSkillFile[] {
  const sourceRoot = resolve(sourceDir);
  if (!existsSync(sourceRoot) || !lstatSync(sourceRoot).isDirectory()) {
    throw new Error("Skill directory was not found.");
  }
  const targetRoot = join(artifactRoot, "skills", revisionId);
  const files = listSkillFiles(sourceRoot);
  mkdirSync(targetRoot, { recursive: true });
  return files.map((relativePath) => {
    const sourcePath = pathFromRelative(sourceRoot, relativePath);
    const targetPath = pathFromRelative(targetRoot, relativePath);
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
    return {
      relativePath,
      objectKey: targetPath,
      sha256: fileChecksum(targetPath),
      sizeBytes: statSync(targetPath).size,
    };
  });
}

export function recursiveSkillChecksum(sourceDir: string): string {
  const sourceRoot = resolve(sourceDir);
  const hash = createHash("sha256");
  for (const relativePath of listSkillFiles(sourceRoot)) {
    hash.update(relativePath);
    hash.update(readFileSync(pathFromRelative(sourceRoot, relativePath)));
  }
  return hash.digest("hex");
}

export function assertSafeSkillPath(relativePath: string): string {
  const clean = relativePath.trim().replaceAll("\\", "/");
  if (!clean || isAbsolute(clean)) throw new Error(`Invalid skill artifact path: ${relativePath}`);
  const normalized = normalize(clean).replaceAll("\\", "/");
  if (normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`Invalid skill artifact path: ${relativePath}`);
  }
  return normalized;
}

function listSkillFiles(root: string): string[] {
  const files: string[] = [];
  walk(root, root, files);
  return files.sort();
}

function walk(root: string, currentDir: string, files: string[]): void {
  for (const name of readdirSync(currentDir).sort()) {
    if (name.startsWith(".")) continue;
    const path = join(currentDir, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error("Skill directories must not contain symbolic links.");
    if (stat.isDirectory()) {
      walk(root, path, files);
      continue;
    }
    if (stat.isFile()) files.push(relativePath(root, path));
  }
}

function relativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function pathFromRelative(root: string, relativePath: string): string {
  const safe = assertSafeSkillPath(relativePath);
  return join(root, ...safe.split("/"));
}

function fileChecksum(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
