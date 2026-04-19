import log from "electron-log/main.js";
import type { Migration, MigrationDeps } from "./types";

export function createMigrationsV47V47(deps: MigrationDeps): Migration[] {
  const { db } = deps;
  return [
    {
      // Durable fan-out ledger for document-creation side effects.
      //
      // Before v47 `createDocumentWithLifecycle` wrapped every downstream
      // hook (automation dispatch, thread integration, checkpoint engine,
      // reviewer wake) in an individual `try/catch` and always returned
      // success. A failure in any single hook left the document row live
      // with a silently incomplete lifecycle — thread views, approvals,
      // or reviewer wakes disappeared without trace.
      //
      // The ledger is the tracked-state surface the operator reads to
      // reason about lifecycle coverage: one row per hook per document
      // is inserted inside the same transaction as the document write.
      // The processor advances `status` from `pending` to `succeeded` or
      // `failed`, stamps `last_error` on failure, and `attempts` lets the
      // sweeper retry within a bounded policy.
      version: 47,
      name: "document_lifecycle_events_ledger",
      fn: () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS document_lifecycle_events (
            id TEXT PRIMARY KEY,
            company_id TEXT NOT NULL,
            document_id TEXT NOT NULL,
            hook_type TEXT NOT NULL,
            status TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            payload_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT
          )
        `);
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_document_lifecycle_events_company
          ON document_lifecycle_events(company_id, status, updated_at)
        `);
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_document_lifecycle_events_document
          ON document_lifecycle_events(document_id, hook_type)
        `);
        log.info("[migration v47] document_lifecycle_events ledger installed");
      },
    },
  ];
}
