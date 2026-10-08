import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveWorkspacePath } from "./files/workspace-path";
import { runCommand } from "./workspace-command";
import { optionalString, requireString } from "./agent-tool-args";
import type { AgentToolContext } from "./agent-tools";
import type { ToolCall, ToolDefinition } from "./provider-tool-turn";
import { PAGE_TOOL_PROPERTIES, pageText, readPageArgs, type PageRequest } from "./text-paging";

const LIST_FILES_LIMIT = 400;
/** Dependency and VCS internals: huge, machine-managed, never what an agent is looking for. */
const LIST_SKIPPED_DIRECTORIES = new Set([".git", "node_modules", ".pnpm-store", "out", "dist"]);

/**
 * The workspace tools turn agents from document writers into workers: they can
 * see what exists (list_files), study it (read_file), and — on tasks the
 * operator granted filesystem access — actually build and test (run_command).
 * write_deliverable in agent-deliverable-tools remains the write path.
 */
export const WORKSPACE_TOOLS: ToolDefinition[] = [
  {
    name: "list_files",
    description: "List the files in the company workspace (dependency and VCS folders are skipped). Check what already exists before writing or changing anything.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string", description: "Subfolder to list, relative to the workspace root. Omit for the whole workspace." },
      },
      required: [],
    },
  },
  {
    name: "read_file",
    description: "Read a file from the company workspace — whole, a range of lines, or only the lines matching a search. Always read existing code or documents before editing them — never guess at their contents.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string", description: "File path relative to the workspace root, e.g. 'src/index.ts'." },
        ...PAGE_TOOL_PROPERTIES,
      },
      required: ["path"],
    },
  },
  {
    name: "run_command",
    description: "Run a real shell command inside the workspace (install, build, test, git). Available only on tasks that carry filesystem access — for engineering work, real output means the code builds and the tests pass, not a description of them.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        command: { type: "string", description: "The command to run, e.g. 'npm test'. It runs with the workspace as working directory." },
      },
      required: ["command"],
    },
  },
];

const WORKSPACE_TOOL_NAMES = new Set(WORKSPACE_TOOLS.map((tool) => tool.name));

export function isWorkspaceTool(name: string): boolean {
  return WORKSPACE_TOOL_NAMES.has(name);
}

export async function executeWorkspaceTool(ctx: AgentToolContext, call: ToolCall): Promise<string> {
  try {
    if (!ctx.workspace) throw new Error("No workspace is bound to this task.");
    switch (call.name) {
      case "list_files":
        return listFiles(ctx.workspace.localPath, optionalString(call.arguments.path) ?? undefined);
      case "read_file":
        return readFile(ctx.workspace.localPath, requireString(call.arguments.path, "path"), readPageArgs(call.arguments));
      case "run_command": {
        if (!ctx.workspace.writeAccess) {
          throw new Error("This task does not carry filesystem access. Ask for a task with requires_filesystem, which the operator approves.");
        }
        return await runCommand(ctx.workspace.localPath, requireString(call.arguments.command, "command"));
      }
      default:
        throw new Error(`Unknown workspace tool "${call.name}".`);
    }
  } catch (error) {
    return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function listFiles(workspaceRoot: string, subPath: string | undefined): string {
  const base = subPath ? resolveWorkspacePath(workspaceRoot, subPath).absolute : workspaceRoot;
  const entries: string[] = [];
  const walk = (directory: string, prefix: string): void => {
    if (entries.length >= LIST_FILES_LIMIT) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entries.length >= LIST_FILES_LIMIT) return;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (LIST_SKIPPED_DIRECTORIES.has(entry.name)) continue;
        walk(join(directory, entry.name), relative);
      } else {
        entries.push(relative);
      }
    }
  };
  walk(base, "");
  if (entries.length === 0) return "The workspace folder is empty.";
  const truncation = entries.length >= LIST_FILES_LIMIT ? `\n(truncated at ${LIST_FILES_LIMIT} files — pass a subfolder path to narrow down)` : "";
  return entries.join("\n") + truncation;
}

function readFile(workspaceRoot: string, relativePath: string, page: PageRequest): string {
  const { absolute, relativePosix } = resolveWorkspacePath(workspaceRoot, relativePath);
  const stats = statSync(absolute);
  if (!stats.isFile()) throw new Error(`${relativePosix} is not a file.`);
  return pageText(relativePosix, readFileSync(absolute, "utf8"), page);
}
