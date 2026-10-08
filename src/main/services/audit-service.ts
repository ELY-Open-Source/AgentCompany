import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { CreateAuditReplayInput } from "../../shared/commands";
import { createId } from "../../shared/ids";

interface AuditEventRow {
  id: string;
  org_id: string;
  entity_type: string;
  entity_id: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  payload_json: string;
  created_at: string;
}

interface ChatThreadRow {
  id: string;
  root_message_id: string | null;
}

interface ReplayEvent {
  id: string;
  entityType: string;
  entityId: string;
  actorType: string;
  actorId: string | null;
  action: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

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

  createThreadReplay(input: CreateAuditReplayInput): string {
    const thread = this.requireThread(input.orgId, input.threadId);
    this.requireEmployee(input.orgId, input.createdByEmployeeId);
    const messageIds = this.threadMessageIds(input.orgId, input.threadId, thread.root_message_id);
    const events = this.threadEvents(input.orgId, input.threadId, messageIds);
    if (events.length === 0) throw new Error("Thread replay requires audit events.");
    const replay = {
      threadId: input.threadId,
      rootMessageId: thread.root_message_id,
      messageIds: [...messageIds].sort(),
      events,
    };
    const replayJson = JSON.stringify(replay);
    const eventDigest = createHash("sha256").update(replayJson).digest("hex");
    const id = createId("arp");
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into audit_replay_runs(
        id, org_id, thread_id, event_count, event_digest, replay_json,
        created_by_employee_id, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.orgId, input.threadId, events.length, eventDigest, replayJson, input.createdByEmployeeId, now);
    this.record({
      orgId: input.orgId,
      entityType: "audit_replay_run",
      entityId: id,
      actorType: "employee",
      actorId: input.createdByEmployeeId,
      action: "created",
      payload: { threadId: input.threadId, eventCount: events.length, eventDigest },
    });
    return id;
  }

  private requireThread(orgId: string, threadId: string): ChatThreadRow {
    const thread = this.db.prepare("select id, root_message_id from chat_threads where id = ? and org_id = ?")
      .get(threadId, orgId) as ChatThreadRow | undefined;
    if (!thread) throw new Error("Chat thread was not found.");
    return thread;
  }

  private requireEmployee(orgId: string, employeeId: string): void {
    const employee = this.db.prepare("select id from employees where id = ? and org_id = ?").get(employeeId, orgId);
    if (!employee) throw new Error("Audit replay employee was not found.");
  }

  private threadMessageIds(orgId: string, threadId: string, rootMessageId: string | null): Set<string> {
    const ids = new Set<string>();
    if (rootMessageId) ids.add(rootMessageId);
    const rows = this.db.prepare("select id from chat_messages where org_id = ? and thread_id = ? order by created_at asc")
      .all(orgId, threadId) as Array<{ id: string }>;
    for (const row of rows) ids.add(row.id);
    return ids;
  }

  private threadEvents(orgId: string, threadId: string, messageIds: Set<string>): ReplayEvent[] {
    const rows = this.db.prepare("select * from audit_events where org_id = ? order by created_at asc, id asc")
      .all(orgId) as unknown as AuditEventRow[];
    return rows
      .filter((row) => eventMatchesThread(row, threadId, messageIds))
      .map((row) => ({
        id: row.id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        actorType: row.actor_type,
        actorId: row.actor_id,
        action: row.action,
        payload: parsePayload(row.payload_json),
        createdAt: row.created_at,
      }));
  }
}

function eventMatchesThread(row: AuditEventRow, threadId: string, messageIds: Set<string>): boolean {
  if (row.entity_type === "audit_replay_run") return false;
  if (row.entity_type === "chat_thread" && row.entity_id === threadId) return true;
  if (row.entity_type === "chat_message" && messageIds.has(row.entity_id)) return true;
  const payload = parsePayload(row.payload_json);
  return stringField(payload, "threadId") === threadId
    || stringField(payload, "sourceThreadId") === threadId
    || messageIds.has(stringField(payload, "messageId"))
    || messageIds.has(stringField(payload, "sourceMessageId"));
}

function parsePayload(payloadJson: string): Record<string, unknown> {
  const parsed = JSON.parse(payloadJson) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Audit event payload is invalid.");
  return parsed as Record<string, unknown>;
}

function stringField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}
