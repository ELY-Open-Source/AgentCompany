import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
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
  _transaction: Transaction,
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
      "select id, task_session_id, sequence, kind, role, payload_json, created_at from session_entries where task_session_id = ? and is_superseded = 0 order by created_at asc, sequence asc",
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

  return { append, listActive };
}
