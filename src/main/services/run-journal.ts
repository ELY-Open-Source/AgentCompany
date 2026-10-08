import type { DatabaseSync } from "node:sqlite";
import { createId } from "../../shared/ids";
import type { ToolCall } from "./provider-tool-turn";

/** Tools that only look; everything else changes the company or the world and is journaled. */
const READ_ONLY_TOOLS = new Set([
  "company_status", "fetch_url", "list_connectors", "list_documents", "list_files", "list_skills",
  "read_attachment", "read_document", "read_file", "read_messages", "search_knowledge", "web_search",
]);
const JOURNAL_LINES = 40;
const FIELD_CHARS = 160;

/** Records a call that tried to change something, with its result, so later sessions build on it instead of repeating it. */
export function recordRunAction(db: DatabaseSync, input: { orgId: string; runId: string; taskId: string; call: ToolCall; output: string }): void {
  if (READ_ONLY_TOOLS.has(input.call.name)) return;
  db.prepare(`
    insert into run_actions(id, org_id, run_id, task_id, tool_name, arguments_excerpt, result_excerpt, created_at)
    values (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(createId("rac"), input.orgId, input.runId, input.taskId, input.call.name,
    clip(JSON.stringify(input.call.arguments)), clip(input.output.split("\n")[0] ?? ""), new Date().toISOString());
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
  if (lastFailure?.error_message) {
    lines.push("", `The last session on this task failed with: ${lastFailure.error_message}. Pick up from there instead of starting over.`);
  }
  return lines;
}

function clip(text: string): string {
  return text.length > FIELD_CHARS ? `${text.slice(0, FIELD_CHARS)}...` : text;
}
