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

export function currentProviderUsageWindow(now = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}
