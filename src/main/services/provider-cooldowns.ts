import type { DatabaseSync } from "node:sqlite";

/** Without a provider-given wait, parks double from this base with each failure in a row, up to the cap. */
const BACKOFF_BASE_MS = 2 * 60_000;
const BACKOFF_CAP_MS = 30 * 60_000;
/** A provider-given wait is honored within these bounds. */
const RETRY_AFTER_MIN_MS = 30_000;
const RETRY_AFTER_MAX_MS = 60 * 60_000;

interface CooldownRow {
  provider_id: string;
  label: string;
  until_ms: number;
  strikes: number;
  interactive_probed_at_ms: number | null;
}

/** Parks for providers that reported a transient failure, stored so a restart keeps waiting instead of hammering them. */
export class ProviderCooldowns {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number) {}

  /** Parks a provider after a transient failure, for the wait it gave or a growing backoff. */
  park(provider: { id: string; label: string }, message: string, retryAfterMs: number | null): void {
    const row = this.row(provider.id);
    const wasParked = row !== undefined && row.until_ms > this.now();
    const strikes = (row?.strikes ?? 0) + 1;
    const waitMs = retryAfterMs !== null
      ? Math.min(Math.max(retryAfterMs, RETRY_AFTER_MIN_MS), RETRY_AFTER_MAX_MS)
      : Math.min(BACKOFF_BASE_MS * 2 ** (strikes - 1), BACKOFF_CAP_MS);
    // A failed probe must not unlock endless probes: re-arming the park keeps the spent-probe mark.
    const probedAt = wasParked ? row.interactive_probed_at_ms : null;
    this.db.prepare(`
      insert into provider_cooldowns(provider_id, label, until_ms, strikes, interactive_probed_at_ms) values (?, ?, ?, ?, ?)
      on conflict(provider_id) do update set label = excluded.label, until_ms = excluded.until_ms, strikes = excluded.strikes,
        interactive_probed_at_ms = excluded.interactive_probed_at_ms
    `).run(provider.id, provider.label, this.now() + waitMs, strikes, probedAt);
    console.warn(`[task-queue] provider "${provider.label}" reported a transient failure ("${message}"); its tasks are parked for ${Math.round(waitMs / 1000)}s (failure ${strikes} in a row).`);
  }

  /** Providers currently parked; expired parks end (with a log line) but keep their strike count until a request is served. */
  cooledProviderIds(): string[] {
    const rows = this.db.prepare("select provider_id, label, until_ms from provider_cooldowns where until_ms > 0").all() as Array<{ provider_id: string; label: string; until_ms: number }>;
    const active: string[] = [];
    for (const row of rows) {
      if (row.until_ms > this.now()) {
        active.push(row.provider_id);
        continue;
      }
      this.db.prepare("update provider_cooldowns set until_ms = 0, interactive_probed_at_ms = null where provider_id = ?").run(row.provider_id);
      console.info(`[task-queue] provider "${row.label}" cooldown ended; its tasks resume.`);
    }
    return active;
  }

  /** Parked providers whose one founder-probe for this park is already spent; the interactive lane skips only these. */
  interactiveCooledProviderIds(): string[] {
    const active = new Set(this.cooledProviderIds());
    const probed = this.db.prepare("select provider_id from provider_cooldowns where interactive_probed_at_ms is not null").all() as Array<{ provider_id: string }>;
    return probed.map((row) => row.provider_id).filter((id) => active.has(id));
  }

  /** Marks the parked provider's founder-probe as spent (no-op when healthy). */
  noteInteractiveProbe(providerId: string): void {
    this.db.prepare("update provider_cooldowns set interactive_probed_at_ms = ? where provider_id = ? and until_ms > ?").run(this.now(), providerId, this.now());
  }

  /** A served request is proof of health: the park and the failure streak end. */
  clear(provider: { id: string; label: string }): void {
    const row = this.row(provider.id);
    if (!row) return;
    this.db.prepare("delete from provider_cooldowns where provider_id = ?").run(provider.id);
    if (row.until_ms > this.now()) console.info(`[task-queue] provider "${provider.label}" served a request; cooldown lifted early.`);
  }

  private row(providerId: string): CooldownRow | undefined {
    return this.db.prepare("select provider_id, label, until_ms, strikes, interactive_probed_at_ms from provider_cooldowns where provider_id = ?")
      .get(providerId) as CooldownRow | undefined;
  }
}
