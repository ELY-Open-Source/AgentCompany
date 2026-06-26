import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Resolves a caller-supplied relative path against a workspace root and rejects
 * anything that escapes it (absolute paths or `..` traversal). Both writing a
 * deliverable and ingesting one back as a file object go through here, so an
 * agent-supplied path can only ever land inside the folder the operator bound
 * to the company — never `../../.ssh/id_rsa`.
 */
export function resolveWorkspacePath(workspaceRoot: string, relativePath: string): { absolute: string; relativePosix: string } {
  const root = resolve(workspaceRoot);
  const requested = relativePath.trim().replace(/^[\\/]+/, "");
  if (!requested) throw new Error("Workspace path is required.");
  if (isAbsolute(requested)) throw new Error("Workspace path must be relative to the workspace.");
  const absolute = resolve(root, requested);
  const rel = relative(root, absolute);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Workspace path escapes the workspace root.");
  }
  return { absolute, relativePosix: rel.split(sep).join("/") };
}
