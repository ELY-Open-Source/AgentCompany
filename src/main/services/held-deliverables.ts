import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { writeDeliverable } from "./deliverable-writer";
import { DocumentService } from "./document-service";
import { recordWorkspaceFile } from "./files/file-object-store";
import { resolveWorkspacePath } from "./files/workspace-path";

/** What a held deliverable will become once approved. */
export type HeldTarget =
  | { kind: "file"; workspaceRoot: string; relativePath: string }
  | { kind: "document_create"; title: string; docType: string }
  | { kind: "document_update"; documentId: string; baseVersion: number; title: string; reason: string };

interface HeldRow {
  id: string;
  org_id: string;
  kind: HeldTarget["kind"];
  agent_id: string | null;
  task_id: string | null;
  goal_id: string | null;
  project_id: string | null;
  workspace_root: string | null;
  relative_path: string | null;
  document_id: string | null;
  base_version: number | null;
  title: string | null;
  doc_type: string | null;
  reason: string | null;
  content: string;
}

/** Whether this org's board reviews deliverables before they are written. */
export function reviewsDeliverables(db: DatabaseSync, orgId: string): boolean {
  const org = db.prepare("select review_deliverables from organizations where id = ?").get(orgId) as { review_deliverables: number } | undefined;
  if (!org) throw new Error("Organization was not found.");
  return org.review_deliverables === 1;
}

/** Keeps a deliverable out of the workspace and library until its review is approved. */
export function holdDeliverable(
  db: DatabaseSync,
  input: { id: string; approvalId: string; orgId: string; agentId: string; taskId: string | null; goalId: string | null; projectId: string | null; target: HeldTarget; content: string },
): void {
  const target = input.target;
  // A file path that could never be written is refused now, not at approval.
  if (target.kind === "file") resolveWorkspacePath(target.workspaceRoot, target.relativePath);
  db.prepare(`
    insert into held_deliverables(
      id, org_id, approval_id, kind, agent_id, task_id, goal_id, project_id, workspace_root, relative_path,
      document_id, base_version, title, doc_type, reason, content, state, created_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'held', ?)
  `).run(
    input.id, input.orgId, input.approvalId, target.kind, input.agentId, input.taskId, input.goalId, input.projectId,
    target.kind === "file" ? target.workspaceRoot : null,
    target.kind === "file" ? target.relativePath : null,
    target.kind === "document_update" ? target.documentId : null,
    target.kind === "document_update" ? target.baseVersion : null,
    target.kind === "file" ? null : target.title,
    target.kind === "document_create" ? target.docType : null,
    target.kind === "document_update" ? target.reason : null,
    input.content,
    new Date().toISOString(),
  );
  console.info(`[deliverables] held ${target.kind} ${input.id} for review ${input.approvalId}`);
}

/** Writes an approved deliverable where it was meant to go; a declined one is never written. */
export function settleHeldDeliverable(db: DatabaseSync, heldId: string, approved: boolean): void {
  const row = db.prepare("select * from held_deliverables where id = ? and state = 'held'").get(heldId) as HeldRow | undefined;
  if (!row) throw new Error("The held deliverable of this review was not found.");
  db.prepare("update held_deliverables set state = ? where id = ?").run(approved ? "published" : "declined", heldId);
  // Publication is the last write, so a file reaches disk only once every database change before it has succeeded.
  if (approved) publish(db, row);
  console.info(`[deliverables] ${row.kind} ${heldId} ${approved ? "published" : "declined"}`);
}

function publish(db: DatabaseSync, row: HeldRow): void {
  if (row.kind === "file") {
    const { absolute } = resolveWorkspacePath(row.workspace_root!, row.relative_path!);
    const previous = existsSync(absolute) ? readFileSync(absolute) : null;
    try {
      const written = writeDeliverable({ workspaceRoot: row.workspace_root!, relativePath: row.relative_path!, content: row.content });
      recordWorkspaceFile(db, { orgId: row.org_id, ownerType: "agent", ownerId: row.agent_id, workspaceRoot: row.workspace_root!, relativePath: written });
    } catch (error) {
      // A publication that fails leaves the workspace as it was: the old file back, or none.
      if (previous) writeFileSync(absolute, previous);
      else rmSync(absolute, { force: true });
      throw error;
    }
    return;
  }
  const documents = new DocumentService(db);
  if (row.kind === "document_create") {
    documents.create({
      orgId: row.org_id, title: row.title!, docType: row.doc_type!, content: row.content, authorAgentId: row.agent_id,
      reviewerAgentId: null, projectId: row.project_id, goalId: row.goal_id, taskId: row.task_id,
    });
    return;
  }
  const current = db.prepare("select version, status from documents where id = ? and org_id = ?").get(row.document_id, row.org_id) as { version: number; status: string } | undefined;
  if (!current) throw new Error("The document this update was for has been deleted; decline the review.");
  if (current.version !== row.base_version) {
    throw new Error(`The document moved from v${row.base_version} to v${current.version} after this draft was held; decline the review and ask for a fresh draft.`);
  }
  documents.update({
    orgId: row.org_id, documentId: row.document_id!, title: row.title!, content: row.content, status: current.status,
    reason: row.reason!, changedByType: "agent", changedById: row.agent_id!,
  });
}

/** Held work of a task or goal still waiting for review, by title; done and achieved wait for it. */
export function heldWorkTitles(db: DatabaseSync, scope: { taskId: string } | { goalId: string }): string[] {
  const rows = "taskId" in scope
    ? db.prepare("select coalesce(title, relative_path) as name from held_deliverables where task_id = ? and state = 'held'").all(scope.taskId)
    : db.prepare("select coalesce(title, relative_path) as name from held_deliverables where goal_id = ? and state = 'held'").all(scope.goalId);
  return (rows as Array<{ name: string }>).map((row) => row.name);
}
