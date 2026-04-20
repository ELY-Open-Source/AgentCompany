import type { DatabaseSync } from "node:sqlite";

/**
 * B2 Phase 1 step 4/5 — dual-write consistency observability.
 *
 * `verifyPhaseConsistency` inspects the live invariants between the
 * legacy `tasks.status` / `tasks.checkout_run_id` / `tasks.active_run_id`
 * columns and the new `tasks.phase` / `task_leases` shadow surfaces.
 * It does not mutate anything; it reports the divergence count and a
 * small sample so an operator (or the startup hook in dev mode) can
 * confirm dual-write landed the invariants intended by step 3/5.
 *
 * The check intentionally accepts that `status = 'in_review'` maps
 * onto `phase = 'in_progress'` — the canonical phase enum supplied by
 * the user collapses the review stage into the in-flight phase, so an
 * `in_review` task with `phase = 'in_progress'` is *not* a divergence.
 *
 * This is observability only: step 5/5 adds the ESLint rule that
 * prevents new divergence from reaching production, and a future
 * phase swaps the reads over once the mismatch count stabilises at
 * zero.
 */

export interface PhaseConsistencySample {
  taskId: string;
  status: string;
  phase: string | null;
  activeRunId: string | null;
  checkoutRunId: string | null;
  leaseRunId: string | null;
  leaseExpiresAt: string | null;
  reason: string;
}

export interface PhaseConsistencyReport {
  /**
   * Total number of task rows whose legacy columns disagree with the
   * shadow surfaces in a way that dual-write should prevent. Zero is
   * the healthy steady state.
   */
  inconsistent: number;
  /**
   * Up to `sampleLimit` offending rows. Operators use these to drive
   * root-cause investigation without materialising the entire diff.
   */
  mismatches: PhaseConsistencySample[];
}

/**
 * Map from legacy `status` to the expected `phase` under dual-write.
 * Any status value missing from this map is an observability miss —
 * the caller is expected to extend both this table and the v50
 * backfill/trigger simultaneously. Leaving the entry unmapped here
 * would cause every such row to report as inconsistent forever.
 */
const STATUS_TO_EXPECTED_PHASE: Record<string, string> = {
  backlog: "backlog",
  todo: "todo",
  in_progress: "in_progress",
  blocked: "blocked",
  done: "completed",
  cancelled: "cancelled",
  in_review: "in_progress",
};

interface RawRow {
  id: string;
  status: string;
  phase: string | null;
  active_run_id: string | null;
  checkout_run_id: string | null;
  lease_run_id: string | null;
  lease_expires_at: string | null;
}

/**
 * Compute the diff between the legacy lock columns and the new phase
 * + lease shadow. Reports three kinds of mismatch:
 *
 *  - `phase_unexpected`: the shadow `phase` does not match what the
 *    current `status` predicts per the mapping table above. Indicates
 *    the trigger fired on an unexpected status value, or the row was
 *    written through a path that bypassed the trigger.
 *  - `lease_missing`: the legacy columns say the task is owned by a
 *    live run (`active_run_id` or `checkout_run_id` non-null) but the
 *    shadow `task_leases` row is absent. Indicates a dual-write site
 *    that still writes the legacy columns only.
 *  - `lease_orphan`: the shadow has a lease but neither legacy
 *    pointer is set. Indicates a lease release that only ran against
 *    the legacy path (or a race that landed the lease after the
 *    legacy clear).
 *
 * Expired leases whose legacy pointer is also cleared are ignored —
 * they are a stale-lock sweep artefact that a later recoverStaleLocks
 * call would flush anyway.
 */
export function verifyPhaseConsistency(
  db: DatabaseSync,
  options: { sampleLimit?: number } = {},
): PhaseConsistencyReport {
  const sampleLimit = Math.max(0, options.sampleLimit ?? 20);

  const rows = db
    .prepare(
      `SELECT t.id,
              t.status,
              t.phase,
              t.active_run_id,
              t.checkout_run_id,
              l.run_id AS lease_run_id,
              l.expires_at AS lease_expires_at
         FROM tasks t
         LEFT JOIN task_leases l ON l.task_id = t.id`,
    )
    .all() as unknown as RawRow[];

  const mismatches: PhaseConsistencySample[] = [];
  const nowMs = Date.now();
  let inconsistent = 0;

  for (const row of rows) {
    const expectedPhase = STATUS_TO_EXPECTED_PHASE[row.status];
    const hasLegacyOwnership =
      row.active_run_id !== null || row.checkout_run_id !== null;
    const hasLease = row.lease_run_id !== null;
    const leaseExpiresMs = row.lease_expires_at
      ? Date.parse(row.lease_expires_at)
      : Number.NaN;
    const leaseExpired =
      hasLease && Number.isFinite(leaseExpiresMs) && leaseExpiresMs <= nowMs;

    const reasons: string[] = [];

    if (expectedPhase === undefined) {
      reasons.push(`status=${row.status} has no phase mapping`);
    } else if (row.phase !== expectedPhase) {
      reasons.push(`phase=${row.phase ?? "<null>"} expected ${expectedPhase}`);
    }

    if (hasLegacyOwnership && !hasLease) {
      reasons.push("legacy owner set but no lease row");
    }
    if (!hasLegacyOwnership && hasLease && !leaseExpired) {
      reasons.push("lease row present but no legacy owner");
    }

    if (reasons.length === 0) continue;
    inconsistent += 1;
    if (mismatches.length < sampleLimit) {
      mismatches.push({
        taskId: row.id,
        status: row.status,
        phase: row.phase,
        activeRunId: row.active_run_id,
        checkoutRunId: row.checkout_run_id,
        leaseRunId: row.lease_run_id,
        leaseExpiresAt: row.lease_expires_at,
        reason: reasons.join("; "),
      });
    }
  }

  return { inconsistent, mismatches };
}
