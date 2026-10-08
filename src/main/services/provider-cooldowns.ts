/** Without a provider-given wait, parks double from this base with each failure in a row, up to the cap. */
const BACKOFF_BASE_MS = 2 * 60_000;
const BACKOFF_CAP_MS = 30 * 60_000;
/** A provider-given wait is honored within these bounds. */
const RETRY_AFTER_MIN_MS = 30_000;
const RETRY_AFTER_MAX_MS = 60 * 60_000;

/** In-memory parks for providers that reported a transient failure. */
export class ProviderCooldowns {
  private readonly parks = new Map<string, { until: number; label: string; interactiveProbedAt?: number }>();
  /** Transient failures in a row per provider, reset by a served request. */
  private readonly strikes = new Map<string, number>();

  constructor(private readonly now: () => number) {}

  /**
   * Parks a provider after it reported a transient failure (usage limit, rate
   * limit, overload), so the queue stops feeding it doomed runs every tick.
   * The park is in-memory by design: after a restart the first probe run
   * either succeeds or re-arms the cooldown at the cost of one request.
   */
  park(provider: { id: string; label: string }, message: string, retryAfterMs: number | null): void {
    const active = this.parks.get(provider.id);
    const wasParked = active !== undefined && active.until > this.now();
    const strikes = (this.strikes.get(provider.id) ?? 0) + 1;
    this.strikes.set(provider.id, strikes);
    const waitMs = retryAfterMs !== null
      ? Math.min(Math.max(retryAfterMs, RETRY_AFTER_MIN_MS), RETRY_AFTER_MAX_MS)
      : Math.min(BACKOFF_BASE_MS * 2 ** (strikes - 1), BACKOFF_CAP_MS);
    this.parks.set(provider.id, {
      until: this.now() + waitMs,
      label: provider.label,
      // A failed probe must not unlock endless probes: re-arming the park
      // keeps the spent-probe mark until the window expires naturally.
      interactiveProbedAt: wasParked ? active?.interactiveProbedAt : undefined,
    });
    console.warn(`[task-queue] provider "${provider.label}" reported a transient failure ("${message}"); its tasks are parked for ${Math.round(waitMs / 1000)}s (failure ${strikes} in a row).`);
  }

  /**
   * Providers currently inside a transient-failure cooldown. Expired parks are
   * pruned (with a resume log line) so the next tick probes the provider again.
   */
  cooledProviderIds(): string[] {
    const active: string[] = [];
    for (const [id, park] of this.parks) {
      if (park.until > this.now()) {
        active.push(id);
      } else {
        this.parks.delete(id);
        console.info(`[task-queue] provider "${park.label}" cooldown ended; its tasks resume.`);
      }
    }
    return active;
  }

  /**
   * Cooled providers that even the interactive lane must skip: their one
   * founder-probe for this park window is already spent. A cooled provider
   * not yet probed stays interactively claimable — one human message is
   * allowed through to learn whether the outage was a blip, instead of the
   * founder sitting out the whole cooldown for a single failed background
   * request.
   */
  interactiveCooledProviderIds(): string[] {
    return this.cooledProviderIds().filter((id) => this.parks.get(id)?.interactiveProbedAt !== undefined);
  }

  /** Marks the cooled provider's founder-probe as spent (no-op when healthy). */
  noteInteractiveProbe(providerId: string): void {
    const park = this.parks.get(providerId);
    if (park) park.interactiveProbedAt = this.now();
  }

  /** A served request is proof of health: the park ends for everyone at once. */
  clear(provider: { id: string; label: string }): void {
    this.strikes.delete(provider.id);
    if (this.parks.delete(provider.id)) {
      console.info(`[task-queue] provider "${provider.label}" served a request; cooldown lifted early.`);
    }
  }
}
