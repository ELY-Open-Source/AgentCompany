import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type {
  ConversationEventRecord,
  ConversationParticipantRecord,
  ConversationThreadRecord,
  ThreadActorType,
  ThreadEventType,
  ThreadNotifyOn,
  ThreadParticipantRole,
  ThreadSubscriptionRecord,
  ThreadType,
  ThreadWaitingFor,
  ThreadWaitStateRecord,
} from "@shared/types";
import { type ReadAll, type SqliteRow, nowIso } from "./helpers";

export function buildThreadMethods(getDb: () => DatabaseSync, readAll: ReadAll) {
  function getThread(threadId: string, companyId: string): ConversationThreadRecord | null {
    const row = getDb()
      .prepare(
        `SELECT id, company_id, title, type, related_entity_type, related_entity_id, created_at, updated_at
         FROM conversation_threads WHERE id = ? AND company_id = ?`,
      )
      .get(threadId, companyId) as SqliteRow | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      companyId: row.company_id as string,
      title: row.title as string,
      type: row.type as ThreadType,
      relatedEntityType: (row.related_entity_type as string | null) ?? null,
      relatedEntityId: (row.related_entity_id as string | null) ?? null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  return {
    createThread(input: {
      companyId: string;
      title: string;
      type: ThreadType;
      relatedEntityType: string | null;
      relatedEntityId: string | null;
    }): ConversationThreadRecord {
      const id = randomUUID();
      const ts = nowIso();
      getDb()
        .prepare(
          `INSERT INTO conversation_threads (id, company_id, title, type, related_entity_type, related_entity_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, input.companyId, input.title, input.type, input.relatedEntityType, input.relatedEntityId, ts, ts);
      return {
        id,
        companyId: input.companyId,
        title: input.title,
        type: input.type,
        relatedEntityType: input.relatedEntityType,
        relatedEntityId: input.relatedEntityId,
        createdAt: ts,
        updatedAt: ts,
      };
    },

    listThreads(options: {
      companyId: string;
      type?: ThreadType;
      relatedEntityType?: string;
      relatedEntityId?: string;
      limit?: number;
      offset?: number;
    }): ConversationThreadRecord[] {
      const conditions: string[] = ["company_id = ?"];
      const params: SQLInputValue[] = [options.companyId];
      if (options.type) { conditions.push("type = ?"); params.push(options.type); }
      if (options.relatedEntityType) { conditions.push("related_entity_type = ?"); params.push(options.relatedEntityType); }
      if (options.relatedEntityId) { conditions.push("related_entity_id = ?"); params.push(options.relatedEntityId); }
      const where = conditions.join(" AND ");
      const limit = options.limit ?? 50;
      const offset = options.offset ?? 0;
      const rows = readAll<SqliteRow>(
        `SELECT id, company_id, title, type, related_entity_type, related_entity_id, created_at, updated_at
         FROM conversation_threads WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        ...params, limit, offset,
      );
      return rows.map((r) => ({
        id: r.id as string,
        companyId: r.company_id as string,
        title: r.title as string,
        type: r.type as ThreadType,
        relatedEntityType: (r.related_entity_type as string | null) ?? null,
        relatedEntityId: (r.related_entity_id as string | null) ?? null,
        createdAt: r.created_at as string,
        updatedAt: r.updated_at as string,
      }));
    },

    getThread,

    addThreadEvent(input: {
      threadId: string;
      actorId: string;
      actorType: ThreadActorType;
      eventType: ThreadEventType;
      body: string;
      metadataJson: string;
    }): ConversationEventRecord {
      const id = randomUUID();
      const ts = nowIso();
      const db = getDb();
      db.prepare(
        `INSERT INTO conversation_events (id, thread_id, actor_id, actor_type, event_type, body, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, input.threadId, input.actorId, input.actorType, input.eventType, input.body, input.metadataJson, ts);
      db.prepare("UPDATE conversation_threads SET updated_at = ? WHERE id = ?").run(ts, input.threadId);
      return {
        id,
        threadId: input.threadId,
        actorId: input.actorId,
        actorType: input.actorType,
        eventType: input.eventType,
        body: input.body,
        metadataJson: input.metadataJson,
        createdAt: ts,
      };
    },

    listThreadEvents(
      threadId: string,
      companyId: string,
      options: { limit?: number; offset?: number } = {},
    ): ConversationEventRecord[] {
      const limit = options.limit ?? 50;
      const offset = options.offset ?? 0;
      const rows = readAll<SqliteRow>(
        `SELECT id, thread_id, actor_id, actor_type, event_type, body, metadata_json, created_at
         FROM conversation_events
         WHERE thread_id = ?
           AND thread_id IN (SELECT id FROM conversation_threads WHERE id = ? AND company_id = ?)
         ORDER BY created_at ASC LIMIT ? OFFSET ?`,
        threadId, threadId, companyId, limit, offset,
      );
      return rows.map((r) => ({
        id: r.id as string,
        threadId: r.thread_id as string,
        actorId: r.actor_id as string,
        actorType: r.actor_type as ThreadActorType,
        eventType: r.event_type as ThreadEventType,
        body: r.body as string,
        metadataJson: r.metadata_json as string,
        createdAt: r.created_at as string,
      }));
    },

    setThreadWaitState(input: {
      threadId: string;
      companyId: string;
      waitingFor: ThreadWaitingFor;
      relatedApprovalId: string | null;
      reason: string;
    }): ThreadWaitStateRecord {
      const id = randomUUID();
      const ts = nowIso();
      getDb()
        .prepare(
          `INSERT INTO thread_wait_states (id, thread_id, company_id, waiting_for, related_approval_id, reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, input.threadId, input.companyId, input.waitingFor, input.relatedApprovalId, input.reason, ts);
      return {
        id,
        threadId: input.threadId,
        companyId: input.companyId,
        waitingFor: input.waitingFor,
        relatedApprovalId: input.relatedApprovalId,
        reason: input.reason,
        createdAt: ts,
        resolvedAt: null,
      };
    },

    resolveThreadWaitState(waitStateId: string, companyId: string): void {
      const ts = nowIso();
      getDb()
        .prepare(
          `UPDATE thread_wait_states SET resolved_at = ? WHERE id = ? AND company_id = ? AND resolved_at IS NULL`,
        )
        .run(ts, waitStateId, companyId);
    },

    listThreadWaitStates(
      companyId: string,
      options: { resolvedOnly?: boolean } = {},
    ): ThreadWaitStateRecord[] {
      const where = options.resolvedOnly
        ? "company_id = ? AND resolved_at IS NOT NULL"
        : "company_id = ? AND resolved_at IS NULL";
      const rows = readAll<SqliteRow>(
        `SELECT id, thread_id, company_id, waiting_for, related_approval_id, reason, created_at, resolved_at
         FROM thread_wait_states WHERE ${where} ORDER BY created_at DESC`,
        companyId,
      );
      return rows.map((r) => ({
        id: r.id as string,
        threadId: r.thread_id as string,
        companyId: r.company_id as string,
        waitingFor: r.waiting_for as ThreadWaitingFor,
        relatedApprovalId: (r.related_approval_id as string | null) ?? null,
        reason: r.reason as string,
        createdAt: r.created_at as string,
        resolvedAt: (r.resolved_at as string | null) ?? null,
      }));
    },

    // ── Participants ──────────────────────────────────────────────────────

    addParticipant(input: {
      threadId: string;
      participantId: string;
      participantType: ThreadActorType;
      role?: ThreadParticipantRole;
    }): ConversationParticipantRecord {
      const ts = nowIso();
      const role = input.role ?? "member";
      getDb()
        .prepare(
          `INSERT OR IGNORE INTO conversation_participants (thread_id, participant_id, participant_type, role, joined_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(input.threadId, input.participantId, input.participantType, role, ts);
      return {
        threadId: input.threadId,
        participantId: input.participantId,
        participantType: input.participantType,
        role,
        joinedAt: ts,
      };
    },

    listParticipants(threadId: string): ConversationParticipantRecord[] {
      const rows = readAll<SqliteRow>(
        `SELECT thread_id, participant_id, participant_type, role, joined_at
         FROM conversation_participants WHERE thread_id = ? ORDER BY joined_at ASC`,
        threadId,
      );
      return rows.map((r) => ({
        threadId: r.thread_id as string,
        participantId: r.participant_id as string,
        participantType: r.participant_type as ThreadActorType,
        role: r.role as ThreadParticipantRole,
        joinedAt: r.joined_at as string,
      }));
    },

    removeParticipant(threadId: string, participantId: string): void {
      getDb()
        .prepare("DELETE FROM conversation_participants WHERE thread_id = ? AND participant_id = ?")
        .run(threadId, participantId);
    },

    // ── Subscriptions ────────────────────────────────────────────────────

    subscribe(input: {
      threadId: string;
      subscriberId: string;
      subscriberType: ThreadActorType;
      notifyOn?: ThreadNotifyOn;
    }): ThreadSubscriptionRecord {
      const ts = nowIso();
      const notifyOn = input.notifyOn ?? "all";
      getDb()
        .prepare(
          `INSERT OR REPLACE INTO thread_subscriptions (thread_id, subscriber_id, subscriber_type, notify_on, subscribed_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(input.threadId, input.subscriberId, input.subscriberType, notifyOn, ts);
      return {
        threadId: input.threadId,
        subscriberId: input.subscriberId,
        subscriberType: input.subscriberType,
        notifyOn,
        subscribedAt: ts,
      };
    },

    unsubscribe(threadId: string, subscriberId: string): void {
      getDb()
        .prepare("DELETE FROM thread_subscriptions WHERE thread_id = ? AND subscriber_id = ?")
        .run(threadId, subscriberId);
    },

    listSubscriptions(threadId: string): ThreadSubscriptionRecord[] {
      const rows = readAll<SqliteRow>(
        `SELECT thread_id, subscriber_id, subscriber_type, notify_on, subscribed_at
         FROM thread_subscriptions WHERE thread_id = ? ORDER BY subscribed_at ASC`,
        threadId,
      );
      return rows.map((r) => ({
        threadId: r.thread_id as string,
        subscriberId: r.subscriber_id as string,
        subscriberType: r.subscriber_type as ThreadActorType,
        notifyOn: r.notify_on as ThreadNotifyOn,
        subscribedAt: r.subscribed_at as string,
      }));
    },

    listSubscribedThreads(subscriberId: string, companyId: string): ConversationThreadRecord[] {
      const rows = readAll<SqliteRow>(
        `SELECT ct.id, ct.company_id, ct.title, ct.type, ct.related_entity_type, ct.related_entity_id, ct.created_at, ct.updated_at
         FROM conversation_threads ct
         JOIN thread_subscriptions ts ON ct.id = ts.thread_id
         WHERE ts.subscriber_id = ? AND ct.company_id = ?
         ORDER BY ct.updated_at DESC`,
        subscriberId, companyId,
      );
      return rows.map((r) => ({
        id: r.id as string,
        companyId: r.company_id as string,
        title: r.title as string,
        type: r.type as ThreadType,
        relatedEntityType: (r.related_entity_type as string | null) ?? null,
        relatedEntityId: (r.related_entity_id as string | null) ?? null,
        createdAt: r.created_at as string,
        updatedAt: r.updated_at as string,
      }));
    },
  };
}
