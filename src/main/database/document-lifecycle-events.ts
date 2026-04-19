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

export interface ClaimBatchInput {
  /** Upper bound on rows claimed in one pass. */
  limit: number;
  /** Rows whose `attempts` have already reached this cap stay `pending` and are not claimed here; a dead-letter sweep surfaces them separately. */
  maxAttempts: number;
  /** When provided, only claim rows for the given document so the post-commit immediate drain stays scoped. */
  documentId?: string;
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

    /**
     * Atomically claim up to `limit` pending events, flipping each to
     * `running` and incrementing `attempts` in a single statement.
     * Returns the claimed rows so the processor can dispatch them
     * without racing another worker against the same ids. Rows that
     * have already reached `maxAttempts` stay `pending` here — the
     * operator sees them via `listExhausted` and either retries
     * manually or purges.
     */
    claimPendingBatch(input: ClaimBatchInput): DocumentLifecycleEventRow[] {
      const ts = nowIso();
      const documentScope = input.documentId ? "AND document_id = ?" : "";
      const selectSql = `
        SELECT id FROM document_lifecycle_events
        WHERE status = 'pending' AND attempts < ? ${documentScope}
        ORDER BY created_at ASC
        LIMIT ?
      `;
      const updateSql = `
        UPDATE document_lifecycle_events
        SET status = 'running', attempts = attempts + 1, updated_at = ?
        WHERE id IN (${selectSql})
        RETURNING id, company_id, document_id, hook_type, status, attempts, last_error, payload_json, created_at, updated_at, completed_at
      `;
      const params: SQLInputValue[] = [ts, input.maxAttempts];
      if (input.documentId) params.push(input.documentId);
      params.push(input.limit);
      const raw = readAll<LedgerRawRow>(updateSql, ...params);
      return raw.map(mapLedgerRow);
    },

    /**
     * Rescue rows that were claimed by a prior process but never
     * reached `succeeded` or `failed` (typically because the process
     * crashed mid-hook). Rows whose `updated_at` is older than
     * `cutoffIso` move back to `pending` so the next `claimPendingBatch`
     * picks them up; `attempts` is NOT rewound because the earlier
     * claim already counted against the cap.
     */
    reclaimStaleRunning(cutoffIso: string): number {
      const ts = nowIso();
      const result = getDb().prepare(
        "UPDATE document_lifecycle_events SET status = 'pending', updated_at = ? WHERE status = 'running' AND updated_at < ?",
      ).run(ts, cutoffIso);
      return Number(result.changes ?? 0);
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
     * Return to `pending` after a handler failure that the caller wants
     * the processor to retry (e.g. transient network failure). The
     * attempt counter is preserved so the cap still bounds retries.
     */
    markRetryable(id: string, error: string): void {
      const ts = nowIso();
      getDb().prepare(
        "UPDATE document_lifecycle_events SET status = 'pending', last_error = ?, updated_at = ? WHERE id = ?",
      ).run(error.slice(0, 2000), ts, id);
    },

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

    /**
     * Rows that have reached the attempt cap without succeeding. Surfaced
     * to operators so a failing hook is visible instead of disappearing
     * into the `pending` queue once the cap locks it out.
     */
    listExhausted(maxAttempts: number, limit = 200): DocumentLifecycleEventRow[] {
      return readRows(readAll,
        "SELECT id, company_id, document_id, hook_type, status, attempts, last_error, payload_json, created_at, updated_at, completed_at FROM document_lifecycle_events WHERE status = 'pending' AND attempts >= ? ORDER BY updated_at DESC LIMIT ?",
        maxAttempts,
        limit,
      );
    },
  };
}

interface LedgerRawRow {
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
}

function mapLedgerRow(row: LedgerRawRow): DocumentLifecycleEventRow {
  return {
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
  };
}

function readRows(
  readAll: ReadAll,
  sql: string,
  ...params: SQLInputValue[]
): DocumentLifecycleEventRow[] {
  return readAll<LedgerRawRow>(sql, ...params).map(mapLedgerRow);
}
