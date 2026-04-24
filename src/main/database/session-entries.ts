import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { ReadAll, Transaction } from "./helpers";
import { nowIso } from "./helpers";

/**
 * The `session_entries` table only ever stores one kind — full pi
 * `AgentMessage` envelopes emitted by `message_end`. Earlier builds
 * reserved `"compaction"` and `"summary"` variants for a supersede
 * pipeline that never shipped; their writers are gone and the column
 * holds `"message"` for every live row. Narrowing the type prevents
 * new code from writing a dead kind by accident.
 */
export type SessionEntryKind = "message";

export interface SessionEntryRow {
  id: string;
  taskSessionId: string;
  sequence: number;
  kind: SessionEntryKind;
  role: string | null;
  payloadJson: string;
  createdAt: string;
}

export interface AppendInput {
  taskSessionId: string;
  kind: SessionEntryKind;
  role?: string | null;
  payloadJson: string;
}

export function buildSessionEntryMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  transaction: Transaction,
) {
  function nextSequence(taskSessionId: string): number {
    const rows = readAll<{ maxSeq: number | null }>(
      "select max(sequence) as maxSeq from session_entries where task_session_id = ?",
      taskSessionId,
    );
    const max = rows[0]?.maxSeq;
    return (max ?? 0) + 1;
  }

  function append(input: AppendInput): SessionEntryRow {
    const id = randomUUID();
    const sequence = nextSequence(input.taskSessionId);
    const created = nowIso();
    getDb()
      .prepare(
        "insert into session_entries (id, task_session_id, sequence, kind, role, payload_json, is_superseded, created_at) values (?, ?, ?, ?, ?, ?, 0, ?)",
      )
      .run(
        id,
        input.taskSessionId,
        sequence,
        input.kind,
        input.role ?? null,
        input.payloadJson,
        created,
      );
    return {
      id,
      taskSessionId: input.taskSessionId,
      sequence,
      kind: input.kind,
      role: input.role ?? null,
      payloadJson: input.payloadJson,
      createdAt: created,
    };
  }

  function listActive(taskSessionId: string): SessionEntryRow[] {
    const rows = readAll<{
      id: string;
      task_session_id: string;
      sequence: number;
      kind: SessionEntryKind;
      role: string | null;
      payload_json: string;
      created_at: string;
    }>(
      "select id, task_session_id, sequence, kind, role, payload_json, created_at from session_entries where task_session_id = ? and is_superseded = 0 order by sequence asc, created_at asc",
      taskSessionId,
    );
    return rows.map((row) => ({
      id: row.id,
      taskSessionId: row.task_session_id,
      sequence: row.sequence,
      kind: row.kind,
      role: row.role,
      payloadJson: row.payload_json,
      createdAt: row.created_at,
    }));
  }

  function compactWithSummary(input: {
    taskSessionId: string;
    supersedeEntryIds: string[];
    summaryRole: string | null;
    summaryPayloadJson: string;
  }): SessionEntryRow {
    return transaction(() => {
      const uniqueIds = [...new Set(input.supersedeEntryIds)];
      if (uniqueIds.length === 0) {
        throw new Error("session_entries compaction requires at least one entry to supersede.");
      }
      const placeholders = uniqueIds.map(() => "?").join(", ");
      const rows = readAll<{ id: string; sequence: number }>(
        `select id, sequence from session_entries where task_session_id = ? and is_superseded = 0 and id in (${placeholders}) order by sequence asc`,
        input.taskSessionId,
        ...(uniqueIds as SQLInputValue[]),
      );
      if (rows.length !== uniqueIds.length) {
        throw new Error(`session_entries compaction expected ${uniqueIds.length} active row(s), found ${rows.length}.`);
      }
      const summarySequence = rows[0]?.sequence;
      if (summarySequence === undefined) {
        throw new Error("session_entries compaction could not resolve summary sequence.");
      }
      getDb()
        .prepare(`update session_entries set is_superseded = 1 where task_session_id = ? and id in (${placeholders})`)
        .run(input.taskSessionId, ...(uniqueIds as SQLInputValue[]));

      const id = randomUUID();
      const created = nowIso();
      getDb()
        .prepare(
          "insert into session_entries (id, task_session_id, sequence, kind, role, payload_json, is_superseded, created_at) values (?, ?, ?, 'message', ?, ?, 0, ?)",
        )
        .run(id, input.taskSessionId, summarySequence, input.summaryRole, input.summaryPayloadJson, created);
      return {
        id,
        taskSessionId: input.taskSessionId,
        sequence: summarySequence,
        kind: "message",
        role: input.summaryRole,
        payloadJson: input.summaryPayloadJson,
        createdAt: created,
      };
    });
  }

  return { append, listActive, compactWithSummary };
}
