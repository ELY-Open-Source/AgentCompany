import { createHash } from "node:crypto";

/**
 * Per-credential async concurrency gate.
 *
 * The gate hands out a bounded number of concurrent slots per
 * `(provider, apiKey)` pair. When the cap is reached, further
 * `acquire` calls park until an in-flight caller releases its slot.
 *
 * The Boss build seeds a single Fire Pass key shared by every agent.
 * Without serialization, the worker fans out three or more concurrent
 * `streamSimple` calls against the personal-tier router and trips
 * HTTP 429 on every burst. Holding a slot per credential prevents
 * the burst at the source instead of recovering from it after the
 * fact, which keeps the runtime aligned with the project's
 * "let it crash" rule (no retry/backoff fallback layer is added).
 *
 * The gate is process-local. Only one orchestrator worker runs at a
 * time, so a single gate instance correctly serializes every agent
 * sharing a credential.
 */
export type ConcurrencyLimitResolver = (provider: string) => number | null;

export interface CredentialConcurrencyGate {
  acquire(provider: string, apiKey: string, signal?: AbortSignal): Promise<() => void>;
}

interface Waiter {
  notify: () => void;
  cancel: (err: Error) => void;
  signal?: AbortSignal;
  abortListener?: () => void;
}

interface SlotPool {
  inFlight: number;
  readonly limit: number;
  readonly waiters: Waiter[];
}

const NOOP_RELEASE = () => undefined;

function poolKey(provider: string, apiKey: string): string {
  // Hash the apiKey so the Map key cannot echo a raw credential into
  // heap dumps or future debug output — the gate only needs equality.
  const digest = createHash("sha1").update(apiKey).digest("hex").slice(0, 16);
  return `${provider}:${digest}`;
}

function createAbortError(): Error {
  const err = new Error("Aborted while waiting for credential concurrency slot.");
  err.name = "AbortError";
  return err;
}

export class InMemoryCredentialConcurrencyGate implements CredentialConcurrencyGate {
  private readonly pools = new Map<string, SlotPool>();
  private readonly limitFor: ConcurrencyLimitResolver;

  constructor(limitFor: ConcurrencyLimitResolver) {
    this.limitFor = limitFor;
  }

  async acquire(provider: string, apiKey: string, signal?: AbortSignal): Promise<() => void> {
    const limit = this.limitFor(provider);
    if (limit === null) return NOOP_RELEASE;
    if (signal?.aborted) throw createAbortError();
    const key = poolKey(provider, apiKey);
    const pool = this.getOrCreatePool(key, limit);
    if (pool.inFlight < pool.limit) {
      pool.inFlight += 1;
      return this.makeReleaser(key);
    }
    await this.waitForSlot(pool, signal);
    pool.inFlight += 1;
    return this.makeReleaser(key);
  }

  private getOrCreatePool(key: string, limit: number): SlotPool {
    const existing = this.pools.get(key);
    if (existing) return existing;
    const pool: SlotPool = { inFlight: 0, limit, waiters: [] };
    this.pools.set(key, pool);
    return pool;
  }

  private waitForSlot(pool: SlotPool, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        notify: () => {
          this.detachAbort(waiter);
          resolve();
        },
        cancel: (err) => {
          const idx = pool.waiters.indexOf(waiter);
          if (idx >= 0) pool.waiters.splice(idx, 1);
          this.detachAbort(waiter);
          reject(err);
        },
        signal,
      };
      if (signal) {
        const onAbort = () => waiter.cancel(createAbortError());
        waiter.abortListener = onAbort;
        signal.addEventListener("abort", onAbort, { once: true });
      }
      pool.waiters.push(waiter);
    });
  }

  private detachAbort(waiter: Waiter): void {
    if (waiter.abortListener && waiter.signal) {
      waiter.signal.removeEventListener("abort", waiter.abortListener);
    }
  }

  private makeReleaser(key: string): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const pool = this.pools.get(key);
      if (!pool) return;
      pool.inFlight = Math.max(0, pool.inFlight - 1);
      const next = pool.waiters.shift();
      if (next) next.notify();
      if (pool.inFlight === 0 && pool.waiters.length === 0) {
        this.pools.delete(key);
      }
    };
  }
}
