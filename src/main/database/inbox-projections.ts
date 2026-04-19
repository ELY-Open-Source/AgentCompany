import type { DatabaseSync } from "node:sqlite";
import { nowIso } from "./helpers";

/**
 * Ledger accessor for `agent_message_projections`.
 *
 * The projection path (inbox → session shadow) used to assume
 * `markAgentInboxDelivered` acted as its completion mark, but that
 * write lived outside the transaction that appended to the shadow
 * and wrote the thread event. A crash in that window produced a
 * replay that double-inserted both. The ledger is the idempotent
 * gate: a single `INSERT OR IGNORE` per `(message_id, session_id)`
 * short-circuits the rest of the projection closure when the pair
 * has already committed.
 */
export function buildInboxProjectionMethods(getDb: () => DatabaseSync) {
  return {
    /**
     * Attempt to claim a projection slot. Returns true when this call
     * wrote a fresh row, false when the pair was already recorded.
     * Callers run this inside the same transaction that performs the
     * shadow append, the thread-event write, and the delivered mark,
     * so either all four writes commit or none do.
     */
    claimProjection(messageId: string, sessionId: string): boolean {
      const result = getDb().prepare(
        "INSERT OR IGNORE INTO agent_message_projections (message_id, session_id, projected_at) VALUES (?, ?, ?)",
      ).run(messageId, sessionId, nowIso());
      return Number(result.changes ?? 0) > 0;
    },

    /**
     * Purge ledger rows for sessions no agent currently references as
     * its active `session_id`. A rotated session is never read again —
     * its ledger entries only exist to prevent replays against that
     * specific shadow, which no future run will touch. The safety
     * margin (rows younger than the cutoff are preserved) covers
     * rotations that happen mid-sweep so a race cannot strip the
     * ledger under an active run.
     */
    purgeOrphanProjections(cutoffIso: string): number {
      const result = getDb().prepare(
        `DELETE FROM agent_message_projections
          WHERE projected_at < ?
            AND session_id NOT IN (SELECT session_id FROM agents WHERE session_id IS NOT NULL)`,
      ).run(cutoffIso);
      return Number(result.changes ?? 0);
    },
  };
}
