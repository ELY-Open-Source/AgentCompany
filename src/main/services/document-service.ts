import type { DatabaseSync } from "node:sqlite";
import type { CreateDocumentInput, UpdateDocumentInput, DeleteDocumentInput } from "../../shared/commands";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";

export class DocumentService {
  private readonly audit: AuditService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
  }

  create(input: CreateDocumentInput): string {
    const id = createId("doc");
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into documents(id, org_id, title, doc_type, content, status, author_agent_id, reviewer_agent_id, project_id, goal_id, task_id, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.orgId, input.title.trim(), input.docType, input.content, "draft", input.authorAgentId, input.reviewerAgentId, input.projectId, input.goalId, input.taskId, now, now);
    this.audit.record({
      orgId: input.orgId,
      entityType: "document",
      entityId: id,
      actorType: "system",
      actorId: null,
      action: "created",
      payload: { title: input.title.trim(), docType: input.docType },
    });
    return id;
  }

  update(input: UpdateDocumentInput): void {
    const result = this.db.prepare(`
      update documents set title = ?, content = ?, status = ?, updated_at = ? where id = ? and org_id = ?
    `).run(input.title.trim(), input.content, input.status, new Date().toISOString(), input.documentId, input.orgId);
    if (result.changes === 0) throw new Error("Document was not found.");
  }

  delete(input: DeleteDocumentInput): void {
    const result = this.db.prepare("delete from documents where id = ? and org_id = ?").run(input.documentId, input.orgId);
    if (result.changes === 0) throw new Error("Document was not found.");
  }
}
