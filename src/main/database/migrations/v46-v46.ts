import log from "electron-log/main.js";
import type { Migration, MigrationDeps } from "./types";

export function createMigrationsV46V46(deps: MigrationDeps): Migration[] {
  const { db } = deps;
  return [
    {
      // Ledger for `prepareRun` inbox → session-shadow projection.
      //
      // Before v46 the projection sequence — append to the session
      // shadow, write the thread event, mark the inbox row delivered —
      // ran as three independent SQL writes. A crash or worker restart
      // between the append and the delivered mark caused the next run
      // to replay the same inbox row, duplicating transcript turns and
      // thread events.
      //
      // The ledger is keyed by the natural identity of a projection
      // attempt: the combination of the inbox message and the session
      // shadow it lands on. `INSERT OR IGNORE` against that key is the
      // idempotent gate — the first insert wins, a replay silently
      // skips. Callers wrap the ledger insert, the shadow append, the
      // thread-event write, and the delivered-mark in a single
      // `BEGIN IMMEDIATE` transaction so the four writes commit
      // together or roll back together.
      version: 46,
      name: "agent_message_projections_ledger",
      fn: () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS agent_message_projections (
            message_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            projected_at TEXT NOT NULL,
            PRIMARY KEY (message_id, session_id)
          )
        `);
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_agent_message_projections_session
          ON agent_message_projections(session_id, projected_at)
        `);
        log.info("[migration v46] agent_message_projections ledger installed");
      },
    },
  ];
}
