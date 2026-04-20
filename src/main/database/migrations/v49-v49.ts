import log from "electron-log/main.js";
import type { Migration, MigrationDeps } from "./types";
import { columnExists, tableExists } from "./types";

/**
 * Drop the unused `agent_messages.read_at` column.
 *
 * The column was added in v11 when reads were tracked per-message on a
 * single shared receipt. v12 moved read tracking to the
 * `agent_message_reads` join table, which is now the sole source of
 * truth: every consumer that surfaces `readAt` (renderer snapshot,
 * per-agent inbox, board receipts) resolves it from that table.
 * `agent_messages.read_at` has not been written by any production path
 * for multiple releases; leaving it around just forced every SELECT to
 * carry a NULL column through wire-shape layers and invited the next
 * maintainer to accidentally read stale data from it.
 */
export function createMigrationsV49V49(deps: MigrationDeps): Migration[] {
  const { db } = deps;
  return [
    {
      version: 49,
      name: "drop_agent_messages_read_at",
      fn: () => {
        if (!tableExists(db, "agent_messages")) {
          log.info("[migration v49] agent_messages table missing; skipping");
          return;
        }
        if (!columnExists(db, "agent_messages", "read_at")) {
          log.info("[migration v49] agent_messages.read_at already absent; skipping");
          return;
        }
        db.exec("ALTER TABLE agent_messages DROP COLUMN read_at");
        log.info(
          "[migration v49] dropped unused agent_messages.read_at column — reads are tracked per-reader in agent_message_reads",
        );
      },
    },
  ];
}
