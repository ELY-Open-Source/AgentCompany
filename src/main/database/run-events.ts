import type { DatabaseSync } from "node:sqlite";
import { type ReadAll, type SqliteRow, type Transaction, nowIso } from "./helpers";

/**
 * run_events helpers extracted from runs.ts. Every method is spread into
 * the final `buildRunMethods` result so AppDatabase call-sites remain
 * unchanged.
 */
export function buildRunEventMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  transaction: Transaction,
) {
  return {
    appendRunEvent(input: {
      companyId: string; runId: string; agentId: string;
      eventType: string; stream?: string | null; level?: string | null;
      message?: string | null; payload?: Record<string, unknown> | null;
    }): void {
      const ts = nowIso();
      transaction(() => {
        const lastSeq = getDb().prepare(
          "SELECT MAX(seq) as maxSeq FROM run_events WHERE run_id = ?"
        ).get(input.runId) as { maxSeq: number | null } | undefined;
        const seq = (lastSeq?.maxSeq ?? 0) + 1;
        getDb().prepare(
          "INSERT INTO run_events (company_id, run_id, agent_id, seq, event_type, stream, level, message, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(
          input.companyId, input.runId, input.agentId, seq,
          input.eventType, input.stream ?? null, input.level ?? null,
          input.message ?? null, input.payload ? JSON.stringify(input.payload) : null, ts
        );
      });
    },

    listRunEvents(runId: string, companyId: string, opts?: { offset?: number; limit?: number }): Array<{
      id: number; runId: string; agentId: string; seq: number; eventType: string;
      stream: string | null; level: string | null; message: string | null;
      payload: Record<string, unknown> | null; createdAt: string;
    }> {
      const offset = opts?.offset ?? 0;
      const limit = opts?.limit ?? 500;
      return readAll<SqliteRow>(
        "SELECT id, run_id, agent_id, seq, event_type, stream, level, message, payload, created_at FROM run_events WHERE run_id = ? AND company_id = ? ORDER BY seq ASC LIMIT ? OFFSET ?",
        runId, companyId, limit, offset
      ).map((row: SqliteRow) => ({
        id: row.id,
        runId: row.run_id,
        agentId: row.agent_id,
        seq: row.seq,
        eventType: row.event_type,
        stream: row.stream,
        level: row.level,
        message: row.message,
        payload: row.payload ? JSON.parse(row.payload) : null,
        createdAt: row.created_at,
      }));
    },

    listRunEventsAfter(runId: string, companyId: string, afterSeq: number, limit: number): Array<{
      id: number; runId: string; agentId: string; seq: number; eventType: string;
      stream: string | null; level: string | null; message: string | null;
      payload: Record<string, unknown> | null; createdAt: string;
    }> {
      return readAll<SqliteRow>(
        "SELECT id, run_id, agent_id, seq, event_type, stream, level, message, payload, created_at FROM run_events WHERE run_id = ? AND company_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?",
        runId, companyId, afterSeq, limit
      ).map((row: SqliteRow) => ({
        id: row.id,
        runId: row.run_id,
        agentId: row.agent_id,
        seq: row.seq,
        eventType: row.event_type,
        stream: row.stream,
        level: row.level,
        message: row.message,
        payload: row.payload ? JSON.parse(row.payload) : null,
        createdAt: row.created_at,
      }));
    },
  };
}
