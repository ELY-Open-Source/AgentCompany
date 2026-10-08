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
  /** This month's provider-reported spend and tokens; calls without usage or prices are counted, not guessed. */
  costCents: number;
  inputTokens: number;
  outputTokens: number;
  requestsWithoutUsage: number;
  unpricedRequests: number;
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

/**
 * Failure-message signatures of transient provider conditions — the account's
 * usage window filling up, rate limiting, or momentary overload. These verdicts
 * come from the provider's side of the wire and say nothing about the task, so
 * schedulers must treat them as "try again later", never as attempts consumed.
 * Matched case-insensitively against recorded task_runs.error_message rows,
 * which also heals historical rows written before this classification existed.
 */
export const TRANSIENT_PROVIDER_FAILURE_SIGNATURES = [
  PROVIDER_MONTHLY_LIMIT_MESSAGE,
  "usage limit", // ChatGPT-account plans: "The usage limit has been reached"
  "rate limit",
  "too many requests", // HTTP 429 status text
  "overloaded", // "Our servers are currently overloaded. Please try again later."
].map((signature) => signature.toLowerCase());

export function isTransientProviderFailure(message: string | null | undefined): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return TRANSIENT_PROVIDER_FAILURE_SIGNATURES.some((signature) => normalized.includes(signature));
}

export function currentProviderUsageWindow(now = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}
