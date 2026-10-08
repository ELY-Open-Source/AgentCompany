import { readdirSync, readFileSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { resolveWorkspacePath } from "./files/workspace-path";
import { optionalString, requireString } from "./agent-tool-args";
import type { AgentToolContext } from "./agent-tools";
import type { ToolCall, ToolDefinition } from "./provider-tool-turn";
import { PAGE_TOOL_PROPERTIES, pageText, readPageArgs, type PageRequest } from "./text-paging";

const LIST_FILES_LIMIT = 400;
const COMMAND_TIMEOUT_MS = 120_000;
const COMMAND_OUTPUT_CHAR_LIMIT = 16_000;
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

function runCommand(workspaceRoot: string, command: string): Promise<string> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, { shell: true, cwd: workspaceRoot, windowsHide: true });
    let output = "";
    let killedByTimeout = false;
    const timer = setTimeout(() => {
      killedByTimeout = true;
      child.kill();
    }, COMMAND_TIMEOUT_MS);
    const collect = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise(`ERROR: ${error.message}`);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const trimmed = output.length > COMMAND_OUTPUT_CHAR_LIMIT
        ? `${output.slice(0, COMMAND_OUTPUT_CHAR_LIMIT / 2)}\n[... output truncated ...]\n${output.slice(-COMMAND_OUTPUT_CHAR_LIMIT / 2)}`
        : output;
      if (killedByTimeout) {
        resolvePromise(`ERROR: command timed out after ${COMMAND_TIMEOUT_MS / 1000}s and was killed. Partial output:\n${trimmed}`);
        return;
      }
      resolvePromise(`exit code ${code ?? 0}\n${trimmed.trim() || "(no output)"}`);
    });
  });
}
