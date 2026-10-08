import type { DatabaseSync } from "node:sqlite";
import type { CreateDocumentInput, UpdateDocumentInput, DeleteDocumentInput } from "../../shared/commands";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";

export interface DocumentVersion {
  version: number;
  title: string;
  content: string;
  status: string;
  changed_by_type: string;
  changed_by_id: string | null;
  reason: string;
  created_at: string;
}

export class DocumentService {
  private readonly audit: AuditService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
  }

  create(input: CreateDocumentInput): string {
    const id = createId("doc");
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into documents(id, org_id, title, doc_type, content, status, author_agent_id, reviewer_agent_id, project_id, goal_id, task_id, version, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, input.orgId, input.title.trim(), input.docType, input.content, "draft", input.authorAgentId, input.reviewerAgentId, input.projectId, input.goalId, input.taskId, now, now);
    this.writeVersion({
      orgId: input.orgId, documentId: id, version: 1, title: input.title.trim(), content: input.content, status: "draft",
      changedByType: input.authorAgentId ? "agent" : "employee", changedById: input.authorAgentId, reason: "created", at: now,
    });
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

  /** Saves a new version; earlier versions stay readable. */
  update(input: UpdateDocumentInput): number {
    const reason = input.reason.trim();
    if (!reason) throw new Error("A document update needs a reason.");
    this.audit.requireActor(input.orgId, input.changedByType, input.changedById);
    const current = this.db.prepare("select version, title, status from documents where id = ? and org_id = ?")
      .get(input.documentId, input.orgId) as { version: number; title: string; status: string } | undefined;
    if (!current) throw new Error("Document was not found.");
    const version = current.version + 1;
    const now = new Date().toISOString();
    this.db.prepare(`
      update documents set title = ?, content = ?, status = ?, version = ?, updated_at = ? where id = ? and org_id = ?
    `).run(input.title.trim(), input.content, input.status, version, now, input.documentId, input.orgId);
    this.writeVersion({
      orgId: input.orgId, documentId: input.documentId, version, title: input.title.trim(), content: input.content, status: input.status,
      changedByType: input.changedByType, changedById: input.changedById, reason, at: now,
    });
    this.audit.record({
      orgId: input.orgId,
      entityType: "document",
      entityId: input.documentId,
      actorType: input.changedByType,
      actorId: input.changedById,
      action: "revised",
      payload: { version, reason, title: input.title.trim(), status: input.status, previousTitle: current.title, previousStatus: current.status },
    });
    return version;
  }

  versions(orgId: string, documentId: string): DocumentVersion[] {
    return this.db.prepare(`
      select version, title, content, status, changed_by_type, changed_by_id, reason, created_at
      from document_versions where document_id = ? and org_id = ? order by version asc
    `).all(documentId, orgId) as unknown as DocumentVersion[];
  }

  delete(input: DeleteDocumentInput): void {
    this.audit.requireActor(input.orgId, "employee", input.deletedByEmployeeId);
    const doc = this.db.prepare("select title, doc_type, status, version, content from documents where id = ? and org_id = ?")
      .get(input.documentId, input.orgId) as { title: string; doc_type: string; status: string; version: number; content: string } | undefined;
    if (!doc) throw new Error("Document was not found.");
    this.db.prepare("delete from documents where id = ? and org_id = ?").run(input.documentId, input.orgId);
    this.audit.record({
      orgId: input.orgId,
      entityType: "document",
      entityId: input.documentId,
      actorType: "employee",
      actorId: input.deletedByEmployeeId,
      action: "deleted",
      payload: { title: doc.title, docType: doc.doc_type, status: doc.status, version: doc.version, content: doc.content },
    });
  }

  private writeVersion(input: {
    orgId: string; documentId: string; version: number; title: string; content: string; status: string;
    changedByType: string; changedById: string | null; reason: string; at: string;
  }): void {
    this.db.prepare(`
      insert into document_versions(id, org_id, document_id, version, title, content, status, changed_by_type, changed_by_id, reason, created_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(createId("dov"), input.orgId, input.documentId, input.version, input.title, input.content, input.status, input.changedByType, input.changedById, input.reason, input.at);
  }
}
