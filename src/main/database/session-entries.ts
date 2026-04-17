import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ReadAll, Transaction } from "./helpers";
import { nowIso } from "./helpers";

export type SessionEntryKind = "message" | "compaction" | "summary";

export interface SessionEntryRow {
  id: string;
  taskSessionId: string;
  sequence: number;
  kind: SessionEntryKind;
  role: string | null;
  payloadJson: string;
  isSuperseded: boolean;
  createdAt: string;
}

export interface AppendInput {
  taskSessionId: string;
  kind: SessionEntryKind;
  role?: string | null;
  payloadJson: string;
}

export interface ReplaceInput {
  taskSessionId: string;
  entries: Array<{ kind: SessionEntryKind; role?: string | null; payloadJson: string }>;
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
      isSuperseded: false,
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
      is_superseded: number;
      created_at: string;
    }>(
      "select id, task_session_id, sequence, kind, role, payload_json, is_superseded, created_at from session_entries where task_session_id = ? and is_superseded = 0 order by sequence asc",
      taskSessionId,
    );
    return rows.map((row) => ({
      id: row.id,
      taskSessionId: row.task_session_id,
      sequence: row.sequence,
      kind: row.kind,
      role: row.role,
      payloadJson: row.payload_json,
      isSuperseded: false,
      createdAt: row.created_at,
    }));
  }

  function listAll(taskSessionId: string): SessionEntryRow[] {
    const rows = readAll<{
      id: string;
      task_session_id: string;
      sequence: number;
      kind: SessionEntryKind;
      role: string | null;
      payload_json: string;
      is_superseded: number;
      created_at: string;
    }>(
      "select id, task_session_id, sequence, kind, role, payload_json, is_superseded, created_at from session_entries where task_session_id = ? order by sequence asc",
      taskSessionId,
    );
    return rows.map((row) => ({
      id: row.id,
      taskSessionId: row.task_session_id,
      sequence: row.sequence,
      kind: row.kind,
      role: row.role,
      payloadJson: row.payload_json,
      isSuperseded: row.is_superseded === 1,
      createdAt: row.created_at,
    }));
  }

  function replace(input: ReplaceInput): SessionEntryRow[] {
    return transaction(() => {
      getDb()
        .prepare("update session_entries set is_superseded = 1 where task_session_id = ? and is_superseded = 0")
        .run(input.taskSessionId);
      const inserted: SessionEntryRow[] = [];
      for (const entry of input.entries) {
        inserted.push(
          append({
            taskSessionId: input.taskSessionId,
            kind: entry.kind,
            role: entry.role ?? null,
            payloadJson: entry.payloadJson,
          }),
        );
      }
      return inserted;
    });
  }

  function deleteForSession(taskSessionId: string): void {
    getDb()
      .prepare("delete from session_entries where task_session_id = ?")
      .run(taskSessionId);
  }

  return { append, listActive, listAll, replace, deleteForSession };
}
