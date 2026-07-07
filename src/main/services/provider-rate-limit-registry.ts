import type { DatabaseSync } from "node:sqlite";
import type { ProviderObservedRateLimitState } from "../../shared/provider-runtime-domain";
import { createId } from "../../shared/ids";

const REQUEST_LIMIT_HEADERS = [
  "x-ratelimit-limit-requests",
  "x-ratelimit-limit",
  "anthropic-ratelimit-requests-limit",
  "ratelimit-limit",
] as const;

const REMAINING_REQUEST_HEADERS = [
  "x-ratelimit-remaining-requests",
  "x-ratelimit-remaining",
  "anthropic-ratelimit-requests-remaining",
  "ratelimit-remaining",
] as const;

const RESET_HEADERS = [
  "x-ratelimit-reset-requests",
  "x-ratelimit-reset",
  "anthropic-ratelimit-requests-reset",
  "ratelimit-reset",
] as const;

const RETRY_AFTER_HEADERS = ["retry-after"] as const;
const OBSERVED_HEADERS = [
  ...REQUEST_LIMIT_HEADERS,
  ...REMAINING_REQUEST_HEADERS,
  ...RESET_HEADERS,
  ...RETRY_AFTER_HEADERS,
] as const;

export interface RecordProviderRateLimitObservationInput {
  orgId: string;
  providerId: string;
  providerKey: string;
  model: string | null;
  state: ProviderObservedRateLimitState;
}

export class ProviderRateLimitRegistry {
  constructor(private readonly db: DatabaseSync) {}

  recordObservation(input: RecordProviderRateLimitObservationInput): void {
    this.db.prepare(`
      insert into provider_rate_limit_observations(
        id, org_id, provider_id, provider_key, model, request_limit,
        remaining_requests, reset_at, retry_after_ms, raw_state_json, observed_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      createId("prlo"),
      input.orgId,
      input.providerId,
      input.providerKey,
      input.model,
      input.state.requestLimit,
      input.state.remainingRequests,
      input.state.resetAt,
      input.state.retryAfterMs,
      input.state.rawStateJson,
      new Date().toISOString(),
    );
  }
}

export function parseProviderRateLimitHeaders(headers: Headers, now = new Date()): ProviderObservedRateLimitState | null {
  const rawHeaders = collectObservedHeaders(headers);
  const requestLimit = readIntegerHeader(headers, REQUEST_LIMIT_HEADERS);
  const remainingRequests = readIntegerHeader(headers, REMAINING_REQUEST_HEADERS);
  const resetAt = readResetAt(headers, RESET_HEADERS, now);
  const retryAfterMs = readRetryAfterMs(headers, now);
  if (
    requestLimit === null
    && remainingRequests === null
    && resetAt === null
    && retryAfterMs === null
  ) {
    return null;
  }
  return {
    requestLimit,
    remainingRequests,
    resetAt,
    retryAfterMs,
    rawStateJson: JSON.stringify(rawHeaders),
  };
}

function collectObservedHeaders(headers: Headers): Record<string, string> {
  const rawHeaders: Record<string, string> = {};
  for (const key of OBSERVED_HEADERS) {
    const value = headers.get(key);
    if (value?.trim()) rawHeaders[key] = value.trim();
  }
  return rawHeaders;
}

function readIntegerHeader(headers: Headers, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = parseInteger(headers.get(key));
    if (value !== null) return value;
  }
  return null;
}

function readResetAt(headers: Headers, keys: readonly string[], now: Date): string | null {
  for (const key of keys) {
    const value = parseResetValue(headers.get(key), now);
    if (value !== null) return value;
  }
  return null;
}

function readRetryAfterMs(headers: Headers, now: Date): number | null {
  for (const key of RETRY_AFTER_HEADERS) {
    const value = parseRetryAfter(headers.get(key), now);
    if (value !== null) return value;
  }
  return null;
}

function parseInteger(value: string | null): number | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) return null;
  return parsed;
}

function parseResetValue(value: string | null, now: Date): string | null {
  if (!value?.trim()) return null;
  const normalized = value.trim();
  const durationMs = parseDurationMs(normalized);
  if (durationMs !== null) return new Date(now.getTime() + durationMs).toISOString();
  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && numeric >= 0) {
    if (numeric > 1_000_000_000_000) return new Date(numeric).toISOString();
    if (numeric > 1_000_000_000) return new Date(numeric * 1000).toISOString();
    return new Date(now.getTime() + numeric * 1000).toISOString();
  }
  const dateMs = Date.parse(normalized);
  if (!Number.isNaN(dateMs)) return new Date(dateMs).toISOString();
  return null;
}

function parseRetryAfter(value: string | null, now: Date): number | null {
  if (!value?.trim()) return null;
  const normalized = value.trim();
  const seconds = Number(normalized);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const dateMs = Date.parse(normalized);
  if (Number.isNaN(dateMs)) return null;
  return Math.max(0, dateMs - now.getTime());
}

function parseDurationMs(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = match[2];
  if (unit === "ms") return Math.round(amount);
  if (unit === "s") return Math.round(amount * 1000);
  if (unit === "m") return Math.round(amount * 60_000);
  return Math.round(amount * 3_600_000);
}
