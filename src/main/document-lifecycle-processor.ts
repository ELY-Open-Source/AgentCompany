/**
 * Durable processor for `document_lifecycle_events`.
 *
 * `createDocumentWithLifecycle` enqueues hook rows inside the same
 * transaction as `saveDocument`, so the ledger commit is the new
 * durability boundary for cross-process side effects. This processor
 * is what moves rows from `pending` to `succeeded` / `failed`:
 *
 *   - `drainForDocument(documentId)` runs synchronously right after
 *     the save commits so the happy-path latency is unchanged.
 *   - `processBatch(limit)` runs on a periodic sweep so a crash
 *     between commit and the immediate drain is self-healing.
 *   - `reclaimStale()` rescues rows stuck in `running` past the
 *     configured cutoff — typically because the process died
 *     mid-handler — and puts them back on the pending queue so the
 *     next claim picks them up.
 *
 * Claim semantics are atomic: `claimPendingBatch` flips rows to
 * `running` and increments `attempts` in a single UPDATE so two
 * processors cannot race onto the same id. `maxAttempts` caps the
 * retry budget; rows that exhaust it stay `pending` with their
 * attempt count at the cap and surface to the operator through
 * `listExhausted`.
 */

import type { AppDatabase } from "./database";
import { DOCUMENT_LIFECYCLE_PROCESSOR_DEFAULTS } from "./constants";
import type { DocumentLifecycleEventRow } from "./database/document-lifecycle-events";

export interface LifecycleHookContext {
  companyId: string;
  documentId: string;
  eventId: string;
}

export type LifecycleHookOutcome =
  | { kind: "succeeded" }
  | { kind: "retryable"; reason: string }
  | { kind: "failed"; reason: string };

export type LifecycleHookHandler = (
  payload: Record<string, unknown>,
  context: LifecycleHookContext,
) => LifecycleHookOutcome;

export interface LifecycleProcessorOptions {
  db: AppDatabase;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  /** Maximum `attempts` value allowed before a row becomes dead-letter. */
  maxAttempts: number;
  /** Cutoff for reclaiming rows stuck in `running`. */
  staleRunningMs: number;
  /** Batch size for a single sweep. */
  batchSize: number;
  /** Interval for the background sweep. 0 disables periodic work. */
  sweepIntervalMs: number;
}

export function makeLifecycleProcessorOptions(
  overrides: Partial<LifecycleProcessorOptions> & Pick<LifecycleProcessorOptions, "db" | "logger">,
): LifecycleProcessorOptions {
  return {
    ...DOCUMENT_LIFECYCLE_PROCESSOR_DEFAULTS,
    ...overrides,
  };
}

export class DocumentLifecycleProcessor {
  private readonly handlers = new Map<string, LifecycleHookHandler>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(private readonly options: LifecycleProcessorOptions) {}

  register(hookType: string, handler: LifecycleHookHandler): void {
    this.handlers.set(hookType, handler);
  }

  /** Immediate drain scoped to one document, used right after commit. */
  drainForDocument(documentId: string): void {
    const batch = this.options.db.documentLifecycleEvents.claimPendingBatch({
      limit: this.options.batchSize,
      maxAttempts: this.options.maxAttempts,
      documentId,
    });
    for (const row of batch) this.dispatch(row);
  }

  /** Periodic sweep: rescues stragglers across all documents. */
  processBatch(): number {
    const batch = this.options.db.documentLifecycleEvents.claimPendingBatch({
      limit: this.options.batchSize,
      maxAttempts: this.options.maxAttempts,
    });
    for (const row of batch) this.dispatch(row);
    return batch.length;
  }

  /** Move rows stuck in `running` back to `pending`. */
  reclaimStale(): number {
    const cutoff = new Date(Date.now() - this.options.staleRunningMs).toISOString();
    const reclaimed = this.options.db.documentLifecycleEvents.reclaimStaleRunning(cutoff);
    if (reclaimed > 0) {
      this.options.logger.info(
        `[document-lifecycle] reclaimed ${reclaimed} stale running row(s) past ${this.options.staleRunningMs}ms cutoff`,
      );
    }
    return reclaimed;
  }

  /**
   * Start the periodic sweeper. Idempotent: calling twice is a no-op.
   * `stop()` tears it down so the process can exit cleanly.
   */
  start(): void {
    if (this.sweepTimer || this.stopped) return;
    if (this.options.sweepIntervalMs <= 0) return;
    // Run a reclaim + sweep on startup so a crashed process's leftover
    // `running` rows are rescued before the first new claim arrives.
    this.tick();
    this.sweepTimer = setInterval(() => this.tick(), this.options.sweepIntervalMs);
    if (typeof this.sweepTimer.unref === "function") this.sweepTimer.unref();
  }

  stop(): void {
    this.stopped = true;
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  private tick(): void {
    try {
      this.reclaimStale();
    } catch (error) {
      this.options.logger.warn(
        `[document-lifecycle] reclaimStale failed: ${describeError(error)}`,
      );
    }
    try {
      this.processBatch();
    } catch (error) {
      this.options.logger.warn(
        `[document-lifecycle] processBatch failed: ${describeError(error)}`,
      );
    }
  }

  private dispatch(row: DocumentLifecycleEventRow): void {
    const handler = this.handlers.get(row.hookType);
    if (!handler) {
      const reason = `No handler registered for hook type "${row.hookType}"`;
      this.options.db.documentLifecycleEvents.markFailed(row.id, reason);
      this.options.logger.error(`[document-lifecycle] ${reason} (event ${row.id})`);
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = row.payloadJson ? (JSON.parse(row.payloadJson) as Record<string, unknown>) : {};
    } catch (error) {
      const reason = `payload_json parse failed: ${describeError(error)}`;
      this.options.db.documentLifecycleEvents.markFailed(row.id, reason);
      this.options.logger.error(`[document-lifecycle] ${reason} (event ${row.id})`);
      return;
    }

    let outcome: LifecycleHookOutcome;
    try {
      outcome = handler(payload, {
        companyId: row.companyId,
        documentId: row.documentId,
        eventId: row.id,
      });
    } catch (error) {
      const message = describeError(error);
      this.options.logger.error(
        `[document-lifecycle] handler "${row.hookType}" threw for event ${row.id}: ${message}`,
      );
      this.recordOutcome(row, { kind: "retryable", reason: message });
      return;
    }
    this.recordOutcome(row, outcome);
  }

  private recordOutcome(row: DocumentLifecycleEventRow, outcome: LifecycleHookOutcome): void {
    try {
      if (outcome.kind === "succeeded") {
        this.options.db.documentLifecycleEvents.markSucceeded(row.id);
        return;
      }
      if (outcome.kind === "failed") {
        this.options.db.documentLifecycleEvents.markFailed(row.id, outcome.reason);
        return;
      }
      if (row.attempts >= this.options.maxAttempts) {
        this.options.db.documentLifecycleEvents.markFailed(
          row.id,
          `Retry budget exhausted (${row.attempts}/${this.options.maxAttempts}): ${outcome.reason}`,
        );
        return;
      }
      this.options.db.documentLifecycleEvents.markRetryable(row.id, outcome.reason);
    } catch (error) {
      this.options.logger.warn(
        `[document-lifecycle] recordOutcome failed for ${row.id}: ${describeError(error)}`,
      );
    }
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
