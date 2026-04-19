import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { ReadAll } from "./helpers";
import { nowIso } from "./helpers";

/**
 * Document-lifecycle event row shape returned by listers.
 * `status` moves `pending -> running -> (succeeded | failed)`. `attempts`
 * tracks how many processor passes have tried this hook so a sweeper can
 * bound retries without losing the ledger.
 */
export interface DocumentLifecycleEventRow {
  id: string;
  companyId: string;
  documentId: string;
  hookType: string;
  status: "pending" | "running" | "succeeded" | "failed";
  attempts: number;
  lastError: string | null;
  payloadJson: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface EnqueueInput {
  companyId: string;
  documentId: string;
  hookType: string;
  payloadJson?: string;
}

export function buildDocumentLifecycleEventMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
) {
  return {
    enqueue(input: EnqueueInput): string {
      const id = randomUUID();
      const ts = nowIso();
      getDb().prepare(
        `INSERT INTO document_lifecycle_events
          (id, company_id, document_id, hook_type, status, attempts, last_error, payload_json, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, 'pending', 0, NULL, ?, ?, ?, NULL)`,
      ).run(
        id,
        input.companyId,
        input.documentId,
        input.hookType,
        input.payloadJson ?? "{}",
        ts,
        ts,
      );
      return id;
    },

    markRunning(id: string): void {
      const ts = nowIso();
      getDb().prepare(
        "UPDATE document_lifecycle_events SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?",
      ).run(ts, id);
    },

    markSucceeded(id: string): void {
      const ts = nowIso();
      getDb().prepare(
        "UPDATE document_lifecycle_events SET status = 'succeeded', last_error = NULL, updated_at = ?, completed_at = ? WHERE id = ?",
      ).run(ts, ts, id);
    },

    markFailed(id: string, error: string): void {
      const ts = nowIso();
      getDb().prepare(
        "UPDATE document_lifecycle_events SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?",
      ).run(error.slice(0, 2000), ts, id);
    },

    /**
     * Claim the batch of pending events for a document so the caller can
     * drain them post-commit. Ordered by `created_at` so the fan-out
     * reproduces the enqueue order.
     */
    listPendingForDocument(documentId: string): DocumentLifecycleEventRow[] {
      return readRows(readAll,
        "SELECT id, company_id, document_id, hook_type, status, attempts, last_error, payload_json, created_at, updated_at, completed_at FROM document_lifecycle_events WHERE document_id = ? AND status = 'pending' ORDER BY created_at ASC",
        documentId,
      );
    },

    listFailedForCompany(companyId: string, limit = 200): DocumentLifecycleEventRow[] {
      return readRows(readAll,
        "SELECT id, company_id, document_id, hook_type, status, attempts, last_error, payload_json, created_at, updated_at, completed_at FROM document_lifecycle_events WHERE company_id = ? AND status = 'failed' ORDER BY updated_at DESC LIMIT ?",
        companyId,
        limit,
      );
    },
  };
}

function readRows(
  readAll: ReadAll,
  sql: string,
  ...params: SQLInputValue[]
): DocumentLifecycleEventRow[] {
  const raw = readAll<{
    id: string;
    company_id: string;
    document_id: string;
    hook_type: string;
    status: "pending" | "running" | "succeeded" | "failed";
    attempts: number;
    last_error: string | null;
    payload_json: string;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
  }>(sql, ...params);
  return raw.map((row) => ({
    id: row.id,
    companyId: row.company_id,
    documentId: row.document_id,
    hookType: row.hook_type,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    payloadJson: row.payload_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  }));
}
