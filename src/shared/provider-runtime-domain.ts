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

/** The message of the typed error a run gets when its provider's monthly request allowance is used up. */
export const PROVIDER_MONTHLY_LIMIT_MESSAGE = "Provider monthly request limit has been reached.";

export function currentProviderUsageWindow(now = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

/** One model call of a task run, as the run's detail lists it. */
export interface RunRequestRecord {
  id: string;
  purpose: string;
  model: string;
  state: string;
  errorMessage: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costCents: number | null;
  createdAt: string;
  completedAt: string | null;
  inputCharCount: number;
  outputCharCount: number;
  responseText: string | null;
}
