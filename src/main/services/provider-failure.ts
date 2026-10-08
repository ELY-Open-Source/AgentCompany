import { ProviderHttpError } from "./provider-http";

/** Whether a failed call is the provider's passing trouble, and how long it asked us to wait. */
export interface ProviderFailure {
  transient: boolean;
  retryAfterMs: number | null;
}

/** Request timeout, too early, rate limited; every 5xx (server, gateway, Cloudflare 52x, Anthropic 529 overload) is transient too. */
const TRANSIENT_STATUSES = new Set([408, 425, 429]);
/** Connection-level failures from Node's fetch (undici) and sockets. */
const TRANSIENT_CODES = new Set([
  "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "EPIPE",
  "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT",
]);

/** Provider error codes for rate limits, used-up usage windows, overload and server trouble. */
const TRANSIENT_PROVIDER_CODES = new Set([
  "rate_limit_exceeded", "rate_limit_error", "usage_limit_reached", "server_error", "api_error", "overloaded_error",
  "RESOURCE_EXHAUSTED", "UNAVAILABLE", "INTERNAL", "DEADLINE_EXCEEDED",
  "ThrottlingException", "ServiceUnavailableException", "InternalServerException", "ModelNotReadyException",
]);

/** Our own refusal when a provider's monthly request allowance is used up; it lifts when the month turns. */
export class ProviderLimitError extends Error {
  readonly name = "ProviderLimitError";
}

/** Classifies by status, provider code, timeout and network code; the message text never decides. */
export function classifyProviderFailure(error: unknown, now: number): ProviderFailure {
  if (error instanceof ProviderLimitError) return { transient: true, retryAfterMs: null };
  if (error instanceof ProviderHttpError) {
    const state = error.rateLimitState;
    const resetIn = state?.resetAt ? Date.parse(state.resetAt) - now : null;
    const retryAfterMs = state?.retryAfterMs ?? (resetIn !== null && resetIn > 0 ? resetIn : null);
    const transientStatus = error.status !== null && (TRANSIENT_STATUSES.has(error.status) || (error.status >= 500 && error.status < 600));
    return { transient: error.timedOut || transientStatus || TRANSIENT_PROVIDER_CODES.has(error.code ?? ""), retryAfterMs };
  }
  return { transient: TRANSIENT_CODES.has(errorCode(error) ?? ""), retryAfterMs: null };
}

function errorCode(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const own = (error as NodeJS.ErrnoException).code;
  if (typeof own === "string") return own;
  const cause = (error as Error & { cause?: unknown }).cause;
  return cause instanceof Error ? errorCode(cause) : null;
}
