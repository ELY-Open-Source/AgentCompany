import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolveWorkspacePath } from "./files/workspace-path";

/**
 * Writes an agent deliverable into the run's bound workspace folder.
 *
 * The target path is resolved against the workspace root and rejected if it
 * escapes that root (path traversal / absolute paths), so an agent can only
 * write inside the folder the operator bound to the company.
 */
export function writeDeliverable(input: { workspaceRoot: string; relativePath: string; content: string }): string {
  const { absolute, relativePosix } = resolveWorkspacePath(input.workspaceRoot, input.relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, input.content, "utf8");
  return relativePosix;
}
