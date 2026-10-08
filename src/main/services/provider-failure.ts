import { isTransientProviderFailure } from "../../shared/provider-runtime-domain";
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

/** Classifies by status, timeout and network error code first; the message text is the last resort. */
export function classifyProviderFailure(error: unknown, now: number): ProviderFailure {
  if (error instanceof ProviderHttpError) {
    const state = error.rateLimitState;
    const resetIn = state?.resetAt ? Date.parse(state.resetAt) - now : null;
    const retryAfterMs = state?.retryAfterMs ?? (resetIn !== null && resetIn > 0 ? resetIn : null);
    if (error.timedOut || (error.status !== null && (TRANSIENT_STATUSES.has(error.status) || (error.status >= 500 && error.status < 600)))) return { transient: true, retryAfterMs };
    if (error.status !== null) return { transient: isTransientProviderFailure(error.message), retryAfterMs };
  }
  if (TRANSIENT_CODES.has(errorCode(error) ?? "")) return { transient: true, retryAfterMs: null };
  return { transient: isTransientProviderFailure(error instanceof Error ? error.message : String(error)), retryAfterMs: null };
}

function errorCode(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const own = (error as NodeJS.ErrnoException).code;
  if (typeof own === "string") return own;
  const cause = (error as Error & { cause?: unknown }).cause;
  return cause instanceof Error ? errorCode(cause) : null;
}
