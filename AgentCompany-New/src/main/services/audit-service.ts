import type { DatabaseSync } from "node:sqlite";
import { createId } from "../../shared/ids";

export class AuditService {
  constructor(private readonly db: DatabaseSync) {}

  record(input: {
    orgId: string;
    entityType: string;
    entityId: string;
    actorType: string;
    actorId: string | null;
    action: string;
    payload: unknown;
  }): void {
    this.db.prepare(`
      insert into audit_events(id, org_id, entity_type, entity_id, actor_type, actor_id, action, payload_json, created_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      createId("aud"),
      input.orgId,
      input.entityType,
      input.entityId,
      input.actorType,
      input.actorId,
      input.action,
      JSON.stringify(input.payload),
      new Date().toISOString(),
    );
  }
}
