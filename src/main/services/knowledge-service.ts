import type { DatabaseSync } from "node:sqlite";
import type { CreateKnowledgeEntryInput, DeleteKnowledgeEntryInput } from "../../shared/commands";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";

export class KnowledgeService {
  private readonly audit: AuditService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
  }

  create(input: CreateKnowledgeEntryInput): string {
    const id = createId("kne");
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into knowledge_entries(id, org_id, topic, category, content, importance, source_type, source_id, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.orgId, input.topic.trim(), input.category, input.content, input.importance, input.sourceType, input.sourceId, now, now);
    this.audit.record({
      orgId: input.orgId,
      entityType: "knowledge_entry",
      entityId: id,
      actorType: "system",
      actorId: null,
      action: "created",
      payload: { topic: input.topic.trim(), category: input.category },
    });
    return id;
  }

  delete(input: DeleteKnowledgeEntryInput): void {
    const result = this.db.prepare("delete from knowledge_entries where id = ? and org_id = ?").run(input.entryId, input.orgId);
    if (result.changes === 0) throw new Error("Knowledge entry was not found.");
  }
}
