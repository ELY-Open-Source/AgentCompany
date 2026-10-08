import type { DatabaseSync } from "node:sqlite";
import type { CreateKnowledgeEntryInput, DeleteKnowledgeEntryInput, KnowledgeScopeType } from "../../shared/commands";
import { createId } from "../../shared/ids";
import { utcTimestamp } from "./agent-tool-args";
import { AuditService } from "./audit-service";

const SCOPE_TABLES: Record<Exclude<KnowledgeScopeType, "organization">, string> = {
  project: "projects",
  goal: "goals",
  task: "tasks",
  agent: "agents",
};

/** Where a reader stands: the scopes whose knowledge applies to them. */
export interface KnowledgeReader {
  orgId: string;
  agentId: string | null;
  projectId: string | null;
  goalId: string | null;
  taskId: string | null;
}

/** Active, unexpired entries whose scope covers the reader. */
export const APPLICABLE_KNOWLEDGE_SQL = `
  org_id = ? and superseded_by is null and (valid_until is null or valid_until > ?)
  and (scope_type = 'organization'
    or (scope_type = 'project' and scope_id = ?)
    or (scope_type = 'goal' and scope_id = ?)
    or (scope_type = 'task' and scope_id = ?)
    or (scope_type = 'agent' and scope_id = ?))`;

export function applicableKnowledgeArgs(reader: KnowledgeReader): Array<string | null> {
  return [reader.orgId, new Date().toISOString(), reader.projectId, reader.goalId, reader.taskId, reader.agentId];
}

export class KnowledgeService {
  private readonly audit: AuditService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
  }

  create(input: CreateKnowledgeEntryInput): string {
    this.assertScope(input.orgId, input.scopeType, input.scopeId);
    const validUntil = input.validUntil === null ? null : utcTimestamp(input.validUntil);
    if (validUntil === undefined) throw new Error(`"valid_until" must be a UTC ISO timestamp like 2026-12-31T00:00:00Z, got "${input.validUntil}".`);
    const id = createId("kne");
    const now = new Date().toISOString();
    if (input.supersedesId) this.assertSupersedable(input.orgId, input.supersedesId);
    this.db.prepare(`
      insert into knowledge_entries(id, org_id, topic, category, content, importance, source_type, source_id, scope_type, scope_id, valid_until, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.orgId, input.topic.trim(), input.category, input.content, input.importance, input.sourceType, input.sourceId, input.scopeType, input.scopeId, validUntil, now, now);
    if (input.supersedesId) {
      this.db.prepare("update knowledge_entries set superseded_by = ?, updated_at = ? where id = ?").run(id, now, input.supersedesId);
    }
    this.audit.record({
      orgId: input.orgId,
      entityType: "knowledge_entry",
      entityId: id,
      actorType: "system",
      actorId: null,
      action: "created",
      payload: { topic: input.topic.trim(), category: input.category, scopeType: input.scopeType, scopeId: input.scopeId, validUntil, supersedes: input.supersedesId },
    });
    return id;
  }

  delete(input: DeleteKnowledgeEntryInput): void {
    const result = this.db.prepare("delete from knowledge_entries where id = ? and org_id = ?").run(input.entryId, input.orgId);
    if (result.changes === 0) throw new Error("Knowledge entry was not found.");
  }

  private assertScope(orgId: string, scopeType: KnowledgeScopeType, scopeId: string | null): void {
    if (scopeType === "organization") {
      if (scopeId !== null) throw new Error("Organization-wide knowledge takes no scope id.");
      return;
    }
    const table = SCOPE_TABLES[scopeType];
    if (!table) throw new Error(`Unknown knowledge scope "${scopeType}".`);
    if (!scopeId) throw new Error(`Knowledge scoped to a ${scopeType} needs its id.`);
    const exists = this.db.prepare(`select 1 from ${table} where id = ? and org_id = ?`).get(scopeId, orgId);
    if (!exists) throw new Error(`No ${scopeType} with id "${scopeId}" in this company.`);
  }

  private assertSupersedable(orgId: string, entryId: string): void {
    const row = this.db.prepare("select superseded_by from knowledge_entries where id = ? and org_id = ?")
      .get(entryId, orgId) as { superseded_by: string | null } | undefined;
    if (!row) throw new Error(`No knowledge entry with id "${entryId}" to supersede.`);
    if (row.superseded_by) throw new Error(`Knowledge entry ${entryId} was already superseded by ${row.superseded_by}.`);
  }
}
