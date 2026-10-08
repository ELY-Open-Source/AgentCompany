import type { DatabaseSync } from "node:sqlite";
import type { CreateKnowledgeEntryInput, DeleteKnowledgeEntryInput, KnowledgeScopeType, UpdateKnowledgeEntryInput } from "../../shared/commands";
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

export interface KnowledgeRevision {
  revision: number;
  topic: string;
  category: string;
  content: string;
  importance: string;
  changed_by_type: string;
  changed_by_id: string | null;
  reason: string;
  created_at: string;
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
    this.writeRevision({
      orgId: input.orgId, entryId: id, revision: 1, topic: input.topic.trim(), category: input.category, content: input.content,
      importance: input.importance, changedByType: input.sourceType, changedById: input.sourceId,
      reason: input.supersedesId ? `created, superseding ${input.supersedesId}` : "created", at: now,
    });
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

  /** Corrects an entry in place; the prior content stays in its revision history. */
  update(input: UpdateKnowledgeEntryInput): number {
    const reason = input.reason.trim();
    if (!reason) throw new Error("A knowledge correction needs a reason.");
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      update knowledge_entries set topic = ?, category = ?, content = ?, importance = ?, updated_at = ?
      where id = ? and org_id = ?
    `).run(input.topic.trim(), input.category, input.content, input.importance, now, input.entryId, input.orgId);
    if (result.changes === 0) throw new Error(`No knowledge entry with id "${input.entryId}".`);
    const last = this.db.prepare("select max(revision) as revision from knowledge_revisions where entry_id = ?")
      .get(input.entryId) as { revision: number };
    const revision = last.revision + 1;
    this.writeRevision({
      orgId: input.orgId, entryId: input.entryId, revision, topic: input.topic.trim(), category: input.category, content: input.content,
      importance: input.importance, changedByType: input.changedByType, changedById: input.changedById, reason, at: now,
    });
    this.audit.record({
      orgId: input.orgId,
      entityType: "knowledge_entry",
      entityId: input.entryId,
      actorType: input.changedByType === "agent" ? "agent" : "employee",
      actorId: input.changedById,
      action: "revised",
      payload: { revision, reason },
    });
    return revision;
  }

  revisions(orgId: string, entryId: string): KnowledgeRevision[] {
    return this.db.prepare(`
      select revision, topic, category, content, importance, changed_by_type, changed_by_id, reason, created_at
      from knowledge_revisions where entry_id = ? and org_id = ? order by revision asc
    `).all(entryId, orgId) as unknown as KnowledgeRevision[];
  }

  delete(input: DeleteKnowledgeEntryInput): void {
    const result = this.db.prepare("delete from knowledge_entries where id = ? and org_id = ?").run(input.entryId, input.orgId);
    if (result.changes === 0) throw new Error("Knowledge entry was not found.");
  }

  private writeRevision(input: {
    orgId: string; entryId: string; revision: number; topic: string; category: string; content: string;
    importance: string; changedByType: string; changedById: string | null; reason: string; at: string;
  }): void {
    this.db.prepare(`
      insert into knowledge_revisions(id, org_id, entry_id, revision, topic, category, content, importance, changed_by_type, changed_by_id, reason, created_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(createId("knr"), input.orgId, input.entryId, input.revision, input.topic, input.category, input.content, input.importance, input.changedByType, input.changedById, input.reason, input.at);
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
