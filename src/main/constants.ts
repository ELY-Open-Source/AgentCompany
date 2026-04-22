/**
 * Task and workspace locks are considered stale after 15 minutes. The window
 * covers heartbeat cadence, worst-case model/tool round trips, and shutdown
 * recovery margin while still releasing abandoned work within one operator
 * session.
 */
export const STALE_LOCK_TIMEOUT_MS = 15 * 60 * 1000;

export const DOCUMENT_LIFECYCLE_PROCESSOR_DEFAULTS = {
  /** Five attempts cover transient filesystem/indexing failures without hiding a broken hook. */
  maxAttempts: 5,
  /** Document hooks are local metadata side effects; 60s separates a dead handler from a slow one. */
  staleRunningMs: 60_000,
  /** Keeps a burst of document hooks efficient while bounding one sweep's synchronous work. */
  batchSize: 32,
  /** Recovers crash leftovers quickly without turning idle profiles into polling loops. */
  sweepIntervalMs: 15_000,
} as const;
