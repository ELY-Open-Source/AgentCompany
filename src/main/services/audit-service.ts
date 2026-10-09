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

  /** Content changes name a real member of the organization as the actor. */
  requireActor(orgId: string, actorType: "employee" | "agent", actorId: string): void {
    const table = { employee: "employees", agent: "agents" }[actorType];
    if (!table) throw new Error(`Unknown actor type "${actorType}".`);
    const actor = this.db.prepare(`select id from ${table} where id = ? and org_id = ?`).get(actorId, orgId);
    if (!actor) throw new Error(`No ${actorType} "${actorId}" in this organization.`);
  }
}
