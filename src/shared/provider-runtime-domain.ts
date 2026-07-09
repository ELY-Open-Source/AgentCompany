export interface ProviderRateLimitStateRecord {
  orgId: string;
  providerId: string;
  providerKey: string;
  windowStart: string;
  windowEnd: string;
  monthlyRequestLimit: number;
  requestCount: number;
  inputCharCount: number;
  outputCharCount: number;
  remainingRequestCount: number;
  exhausted: boolean;
}

export interface ProviderObservedRateLimitState {
  requestLimit: number | null;
  remainingRequests: number | null;
  resetAt: string | null;
  retryAfterMs: number | null;
  rawStateJson: string;
}

export interface ProviderRateLimitObservationRecord extends ProviderObservedRateLimitState {
  id: string;
  orgId: string;
  providerId: string;
  providerKey: string;
  model: string | null;
  observedAt: string;
}

/**
 * Exact message recorded on runs blocked by a provider's monthly usage window.
 * The heartbeat scheduler matches task_runs.error_message against this string
 * so quota-blocked attempts never consume a task's retry budget — the text is
 * a cross-module contract and also matches rows written by earlier builds
 * that inlined it.
 */
export const PROVIDER_MONTHLY_LIMIT_MESSAGE = "Provider monthly request limit has been reached.";

export function currentProviderUsageWindow(now = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}
