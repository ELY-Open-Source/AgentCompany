/**
 * In-process counter for deprecated HTTP routes (C4-followup #3).
 *
 * The counters let us assert "legacy HTTP hire traffic has hit zero"
 * before physically deleting the deprecated handlers. Keys are the
 * route label the handler passes in (e.g. `POST /api/companies/:companyId/agents`).
 *
 * Scope is intentionally narrow: module-level Map, synchronous mutation,
 * no IO, no fallback. An empty label is a programmer error — we throw
 * so it surfaces in tests instead of silently recording under "".
 *
 * The counter is not exposed over HTTP yet (scope creep). Internal
 * code reads via `readDeprecationCounters()`.
 */

const deprecationCallCounters = new Map<string, number>();

export function incrementDeprecationCall(routeLabel: string): void {
  if (typeof routeLabel !== "string" || routeLabel.length === 0) {
    throw new Error("incrementDeprecationCall requires a non-empty routeLabel");
  }
  const previous = deprecationCallCounters.get(routeLabel) ?? 0;
  deprecationCallCounters.set(routeLabel, previous + 1);
}

export function readDeprecationCounters(): Record<string, number> {
  const snapshot: Record<string, number> = {};
  for (const [label, count] of deprecationCallCounters) {
    snapshot[label] = count;
  }
  return snapshot;
}

export function resetDeprecationCounters(): void {
  deprecationCallCounters.clear();
}
