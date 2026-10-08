import { agentCanReadFile, readVerifiedFile } from "./files/file-object-store";
import { noAccess } from "./agent-attachment-tools";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { optionalStringArray } from "./agent-tool-args";
import type { JsonRecord } from "./provider-http";

export interface TaskHandoff {
  sourceTaskId: string | null;
  sourceThreadId: string | null;
  inputs: Array<{ fileId: string; name: string; sha256: string }>;
  facts: string[];
  openQuestions: string[];
  acceptanceCriteria: string[];
}

export const HANDOFF_TOOL_PROPERTIES = {
  acceptance_criteria: { type: "array", items: { type: "string" }, description: "Checks that prove the task is done." },
  input_file_ids: { type: "array", items: { type: "string" }, description: "file_ids of upstream deliverables the assignee builds on; their current version is pinned." },
  facts: { type: "array", items: { type: "string" }, description: "Facts already verified, so the assignee does not redo them." },
  open_questions: { type: "array", items: { type: "string" }, description: "Questions still unresolved." },
} as const;

export function buildTaskHandoff(
  db: DatabaseSync,
  orgId: string,
  agentId: string,
  assignee: { id: string; name: string } | null,
  source: { taskId: string | null; threadId: string | null },
  args: JsonRecord,
): TaskHandoff {
  const inputs = optionalStringArray(args.input_file_ids, "input_file_ids").map((fileId) => {
    const file = db.prepare("select id, name, storage_path, sha256 from file_objects where id = ? and org_id = ?")
      .get(fileId, orgId) as { id: string; name: string; storage_path: string; sha256: string } | undefined;
    if (!file) throw new Error(`No file with file_id "${fileId}" exists in this company.`);
    // A task's assignee gets its inputs, so only files the delegating agent may read can be handed on.
    if (!agentCanReadFile(db, orgId, file.id, agentId)) throw new Error(noAccess(file.name));
    if (assignee && !agentCanReadFile(db, orgId, file.id, assignee.id)) {
      throw new Error(`${assignee.name} has no access to ${file.name}; it was shared in a conversation they are not part of. Share it with them or assign someone who has it.`);
    }
    // The handoff pins the recorded content; bytes that no longer match it are refused, not pinned as if they were.
    readVerifiedFile({ name: file.name, storagePath: file.storage_path, sha256: file.sha256 });
    return { fileId: file.id, name: file.name, sha256: file.sha256 };
  });
  return {
    sourceTaskId: source.taskId,
    sourceThreadId: source.threadId,
    inputs,
    facts: optionalStringArray(args.facts, "facts"),
    openQuestions: optionalStringArray(args.open_questions, "open_questions"),
    acceptanceCriteria: optionalStringArray(args.acceptance_criteria, "acceptance_criteria"),
  };
}

export function renderTaskHandoff(db: DatabaseSync, orgId: string, handoffJson: string | null): string[] {
  if (!handoffJson) return [];
  const handoff = JSON.parse(handoffJson) as TaskHandoff;
  const lines = ["", "Handoff:"];
  if (handoff.sourceTaskId) {
    const source = db.prepare("select title from tasks where id = ? and org_id = ?")
      .get(handoff.sourceTaskId, orgId) as { title: string } | undefined;
    lines.push(`- Delegated from task "${source?.title ?? "deleted task"}" (task_id=${handoff.sourceTaskId}).`);
  }
  if (handoff.sourceThreadId) lines.push(`- Source conversation: thread_id="${handoff.sourceThreadId}".`);
  for (const input of handoff.inputs) {
    const current = currentSha256(db, orgId, input.fileId);
    const state = !current ? "deleted since the handoff" : current === input.sha256 ? "unchanged since the handoff" : "CHANGED since the handoff — re-check it";
    lines.push(`- Input ${input.name} (file_id=${input.fileId}, sha256=${input.sha256.slice(0, 12)}): ${state}.`);
  }
  for (const fact of handoff.facts) lines.push(`- Verified: ${fact}`);
  for (const question of handoff.openQuestions) lines.push(`- Open question: ${question}`);
  for (const check of handoff.acceptanceCriteria) lines.push(`- Done when: ${check}`);
  return lines;
}

function currentSha256(db: DatabaseSync, orgId: string, fileId: string): string | null {
  const row = db.prepare("select storage_path from file_objects where id = ? and org_id = ?")
    .get(fileId, orgId) as { storage_path: string } | undefined;
  if (!row || !existsSync(row.storage_path)) return null;
  return createHash("sha256").update(readFileSync(row.storage_path)).digest("hex");
}
