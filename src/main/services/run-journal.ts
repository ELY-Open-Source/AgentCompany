import type { DatabaseSync } from "node:sqlite";
import { posix } from "node:path";
import { createId } from "../../shared/ids";
import type { ToolCall } from "./provider-tool-turn";

/** Tools that only look; everything else changes the company or the world and is journaled. */
const READ_ONLY_TOOLS = new Set([
  "company_status", "composio_find_actions", "fetch_url", "list_connectors", "list_documents", "list_files", "list_skills",
  "read_attachment", "read_document", "read_file", "read_messages", "search_knowledge", "web_search",
]);
const JOURNAL_LINES = 40;
const FIELD_CHARS = 160;
const DECLINED_LINES = 5;
/** The arguments that name what an action acted on (retry controls such as confirm_not_done excluded); a tool not listed is identified by all of its arguments. */
const TARGET_ARGUMENTS: Record<string, string[]> = {
  write_deliverable: ["path"], create_document: ["title", "doc_type"], update_document: ["doc_id"], create_task: ["title"],
  update_task_status: ["task_id"], hire_agent: ["name"], grant_connector: ["agent_name", "toolkit"], revoke_connector: ["agent_name", "toolkit"],
  grant_skill: ["agent_name", "skill"], revoke_skill: ["agent_name", "skill"], record_knowledge: ["topic"], revise_knowledge: ["id"],
  update_goal: ["goal_id"], complete_goal: [], run_command: ["command"], composio_run_action: ["action", "account", "arguments"],
};
/** A result line that reports failure: a refused or broken call, or a command that exited non-zero. */
const FAILED_RESULT = (row: string) => `(${row}.result_excerpt like 'ERROR%' or (${row}.result_excerpt like 'exit code %' and ${row}.result_excerpt <> 'exit code 0'))`;
/** What a held deliverable would become, over a `held_deliverables` row alias: one file, one existing document, or a new document by type and title. */
const heldTarget = (row: string) => `(case ${row}.kind when 'file' then ${row}.workspace_root || '/' || ${row}.relative_path when 'document_update' then ${row}.document_id else ${row}.doc_type || ':' || ${row}.title end)`;

/** Records a call that tried to change something, with its result, so later sessions build on it instead of repeating it. */
export function recordRunAction(db: DatabaseSync, input: { orgId: string; runId: string; taskId: string; call: ToolCall; output: string }): void {
  if (READ_ONLY_TOOLS.has(input.call.name)) return;
  db.prepare(`
    insert into run_actions(id, org_id, run_id, task_id, tool_name, arguments_excerpt, result_excerpt, target, created_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(createId("rac"), input.orgId, input.runId, input.taskId, input.call.name,
    clip(JSON.stringify(input.call.arguments)), clip(input.output.split("\n")[0] ?? ""), actionTarget(input.call), new Date().toISOString());
}

/** What the call acted on, or null when its arguments could not be read. */
function actionTarget(call: ToolCall): string | null {
  if (call.argumentsError) return null;
  const keys = TARGET_ARGUMENTS[call.name];
  if (!keys) return JSON.stringify(canonical(call.arguments));
  return JSON.stringify(keys.map((key) => targetValue(key, call.arguments[key])));
}

/** An argument as the tools read it: text trimmed, paths in one spelling, nested values in one key order. */
function targetValue(key: string, value: unknown): unknown {
  if (typeof value !== "string") return canonical(value ?? null);
  return key === "path" ? posix.normalize(value.trim().replaceAll("\\", "/")) : value.trim();
}

/** Why a session that ended normally still failed: actions that failed and were not later done successfully on the same target (any target when unknown). */
export function unresolvedActionFailure(db: DatabaseSync, runId: string): string | null {
  const failed = db.prepare(`
    select a.tool_name, a.result_excerpt from run_actions a
    where a.run_id = ? and ${FAILED_RESULT("a")}
      and not exists (
        select 1 from run_actions later
        where later.run_id = a.run_id and later.tool_name = a.tool_name and later.rowid > a.rowid and not ${FAILED_RESULT("later")}
          and (a.target is null or later.target = a.target)
      )
    order by a.rowid
  `).all(runId) as Array<{ tool_name: string; result_excerpt: string }>;
  if (failed.length === 0) return null;
  const list = failed.map((action) => `${action.tool_name} (${action.result_excerpt})`).join("; ");
  return `The session ended with ${failed.length} failed action${failed.length === 1 ? "" : "s"} it did not redo: ${list}`;
}

/** What earlier sessions (including an interrupted attempt of this run) already did on the task, and where the last one failed. */
export function runJournalLines(db: DatabaseSync, taskId: string): string[] {
  const actions = db.prepare(`
    select tool_name, arguments_excerpt, result_excerpt from (
      select tool_name, arguments_excerpt, result_excerpt, rowid as seq from run_actions where task_id = ? order by rowid desc limit ?
    ) order by seq asc
  `).all(taskId, JOURNAL_LINES) as Array<{ tool_name: string; arguments_excerpt: string; result_excerpt: string }>;
  const lastFailure = db.prepare(`
    select error_message from task_runs where task_id = ? and state in ('completed', 'failed') order by rowid desc limit 1
  `).get(taskId) as { error_message: string | null } | undefined;
  const lines: string[] = [];
  if (actions.length > 0) {
    lines.push("", "Earlier sessions on this task already made these calls; each shows its result. Do not redo the ones that succeeded; retry or fix only what failed:");
    for (const action of actions) lines.push(`- ${action.tool_name}(${action.arguments_excerpt}) -> ${action.result_excerpt}`);
  }
  const declined = db.prepare(`
    select coalesce(h.title, h.relative_path) as name, a.decision_notes as notes
    from held_deliverables h join approvals a on a.id = h.approval_id
    where h.task_id = ? and h.state = 'declined'
      and not exists (
        select 1 from held_deliverables later
        where later.task_id = h.task_id and later.rowid > h.rowid and later.kind = h.kind and ${heldTarget("later")} = ${heldTarget("h")}
      )
    order by h.rowid desc limit ?
  `).all(taskId, DECLINED_LINES) as Array<{ name: string; notes: string | null }>;
  for (const row of declined) lines.push("", `The board declined ${row.name}${row.notes ? `: ${row.notes.trim().replace(/[.。!！]+$/, "")}` : ""}. Redo it before closing the task.`);
  if (lastFailure?.error_message) {
    lines.push("", `The last session on this task failed with: ${lastFailure.error_message}. Pick up from there instead of starting over.`);
  }
  return lines;
}

function clip(text: string): string {
  return text.length > FIELD_CHARS ? `${text.slice(0, FIELD_CHARS)}...` : text;
}

/** The same JSON value with object keys sorted, so equal arguments serialize equally. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
}
