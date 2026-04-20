/**
 * Handler helpers that sit on top of the AppError taxonomy (C6.1 part 1/2).
 *
 * These are thin conveniences, not a framework. Every helper here reduces
 * two lines of boilerplate at the call site; it does NOT swap in default
 * values or change observable behaviour.
 */

import { classifyUnknownError, type AppError, type AppErrorMeta } from "./taxonomy.js";

export interface Logger {
  error: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
}

/**
 * Classify an unknown thrown value and emit a single structured log line.
 * Returns the `AppError` so the caller can still branch on `err.kind`
 * (e.g. throw for `fatal`, return default for `recoverable`).
 *
 * No fallback data is invented: this helper only formats a log line; the
 * caller is still responsible for what to do next.
 */
export function logAppError(
  logger: Logger,
  raw: unknown,
  fallback: AppErrorMeta,
  level: "error" | "warn" = "error",
): AppError {
  const err = classifyUnknownError(raw, fallback);
  const line = `[${err.code}] ${err.message}`;
  const detail = err.context ?? {};
  const causeDetail =
    err.appCause instanceof Error
      ? err.appCause.message
      : err.appCause !== undefined
        ? String(err.appCause)
        : undefined;
  const parts: unknown[] = [line];
  if (Object.keys(detail).length > 0) parts.push(detail);
  if (causeDetail) parts.push(`cause=${causeDetail}`);
  if (level === "warn" && typeof logger.warn === "function") {
    logger.warn(...parts);
  } else {
    logger.error(...parts);
  }
  return err;
}
