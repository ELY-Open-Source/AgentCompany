import { isAbsolute, relative } from "node:path";

/** Paths we never register because they are tool output or build/cache state. */
const IGNORED_PATH_SEGMENTS: readonly string[] = [
  "/.git/",
  "/node_modules/",
  "/.next/",
  "/dist/",
  "/build/",
  "/out/",
  "/.cache/",
  "/.pnpm-store/",
  "/.DS_Store",
];

const IGNORED_EXACT_NAMES: ReadonlySet<string> = new Set([
  ".DS_Store",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  ".gitignore",
]);

const IGNORED_EXTENSIONS: ReadonlySet<string> = new Set([
  ".lock",
  ".log",
  ".map",
  ".min.js",
  ".min.css",
]);

/** Returns true when the path is inside the workspace and passes the artifact filter. */
export function isRegistrablePath(absPath: string, workspacePath: string): boolean {
  const rel = relative(workspacePath, absPath);
  if (rel.startsWith("..") || isAbsolute(rel)) return false;
  const probePath = `/${rel}/`;
  if (IGNORED_PATH_SEGMENTS.some((seg) => probePath.includes(seg))) return false;
  const lastSlash = rel.lastIndexOf("/");
  const basename = lastSlash >= 0 ? rel.slice(lastSlash + 1) : rel;
  if (IGNORED_EXACT_NAMES.has(basename)) return false;
  const dot = basename.lastIndexOf(".");
  if (dot > 0) {
    const ext = basename.slice(dot).toLowerCase();
    if (IGNORED_EXTENSIONS.has(ext)) return false;
    const prevDot = basename.lastIndexOf(".", dot - 1);
    if (prevDot > 0) {
      const compound = basename.slice(prevDot).toLowerCase();
      if (IGNORED_EXTENSIONS.has(compound)) return false;
    }
  }
  return true;
}
