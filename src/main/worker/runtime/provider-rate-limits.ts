/**
 * Per-provider concurrency caps applied to outbound model calls.
 *
 * Each entry limits the number of in-flight `streamSimple` invocations
 * that share a single credential (keyed by `provider` + `apiKey`).
 * Providers absent from the map are treated as uncapped — the gate
 * short-circuits and the call proceeds immediately.
 *
 * `fireworks-firepass` is the load-bearing entry. The Fire Pass router
 * `accounts/fireworks/routers/kimi-k2p6-turbo` is a personal-tier route:
 * the subscription documents zero per-token cost but the upstream
 * router rejects bursts on a single key with HTTP 429. In the Boss
 * build every agent shares the seeded Fire Pass key, so without a cap
 * three concurrent agents trip three 429s — the exact failure mode
 * captured in the overview dashboard. A cap of `1` serializes runs on
 * the shared key without dropping any work.
 *
 * Other providers (`anthropic`, `openai`, `google`, …) advertise
 * generous tier-based budgets and have no evidence of contention in
 * the boss or public builds. Leaving them uncapped honours the
 * project's "let it crash" stance — only providers with a known
 * upstream constraint are throttled here.
 */
export const PROVIDER_CONCURRENCY_LIMITS: Readonly<Record<string, number>> = {
  "fireworks-firepass": 1,
};

export function getProviderConcurrencyLimit(provider: string): number | null {
  const value = PROVIDER_CONCURRENCY_LIMITS[provider];
  return typeof value === "number" && value > 0 ? value : null;
}
