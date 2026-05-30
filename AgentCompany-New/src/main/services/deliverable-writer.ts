import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Writes an agent deliverable into the run's bound workspace folder.
 *
 * The target path is resolved against the workspace root and rejected if it
 * escapes that root (path traversal / absolute paths), so an agent can only
 * write inside the folder the operator bound to the company.
 */
export function writeDeliverable(input: { workspaceRoot: string; relativePath: string; content: string }): string {
  const root = resolve(input.workspaceRoot);
  const requested = input.relativePath.trim().replace(/^[\\/]+/, "");
  if (!requested) throw new Error("Deliverable path is required.");
  if (isAbsolute(requested)) throw new Error("Deliverable path must be relative to the workspace.");
  const target = resolve(root, requested);
  const rel = relative(root, target);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Deliverable path escapes the workspace root.");
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, input.content, "utf8");
  return rel.split(sep).join("/");
}
