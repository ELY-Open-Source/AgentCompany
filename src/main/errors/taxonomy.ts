/**
 * AppError taxonomy (C6.1 part 1/2).
 *
 * Purpose: give every catch site in src/main/ a stable, auditable
 * classification. Today's 248 catch blocks in main/ are overwhelmingly
 * untyped `} catch {}` or `} catch (e) { log.warn(...); return default }`
 * — behaviour is correct case-by-case but the codebase has no machine
 * readable signal for "is this recoverable vs fatal", so:
 *
 *   - graceful-shutdown logic cannot tell a user-input 400 apart from
 *     an upstream 502 apart from a corrupted SQLite file;
 *   - telemetry cannot bucket errors by kind;
 *   - audits of "which catches silently swallow fatal conditions" have
 *     to be by-hand grep.
 *
 * Design invariants (Karpathy "let it crash" + Linus "no silent defaults"):
 *
 *   1. `classifyUnknownError` never invents classification. The caller
 *      MUST pass a fallback meta describing the *expected* worst case;
 *      the helper only honours it when the raw error doesn't already
 *      carry an AppError classification.
 *   2. No fallback defaults on construction. `kind` and `code` are
 *      required; there is no "unknown" catch-all kind because that
 *      would reintroduce the exact silent-fallthrough pattern this
 *      module exists to replace.
 *   3. The taxonomy is intentionally narrow: 4 kinds. Adding a 5th is
 *      a conscious proposal, not a one-off at a call site.
 *
 * Kinds:
 *
 *   - `recoverable`: expected transient failure the caller can work
 *     around without human involvement. Example: JSON parse of a stale
 *     cache entry; re-read or skip.
 *   - `user_input`: caller-supplied input is invalid. Example: user
 *     pasted a malformed URL; surface to UI, do not retry.
 *   - `upstream`: downstream service/dependency failed (HTTP 5xx,
 *     tool provider down, disk IO). Retriable at a higher level or
 *     must be propagated to the user with context.
 *   - `fatal`: process-level invariant broken (DB corruption, missing
 *     required config at runtime). Should abort the current operation
 *     and ideally the process.
 */

import log from "electron-log/main.js";

export type ErrorKind = "recoverable" | "user_input" | "upstream" | "fatal";

export interface AppErrorMeta {
  kind: ErrorKind;
  /**
   * Machine-readable stable identifier for this error site.
   * Convention: `module.subdomain.condition`, e.g. `db.lock.busy`,
   * `ipc.payload.invalid`, `skills.yaml.parse_failed`.
   */
  code: string;
  /** Human-readable summary suitable for logs. */
  message: string;
  /** Original thrown value, preserved for cause-chain inspection. */
  cause?: unknown;
  /** Arbitrary structured context captured at the catch site. */
  context?: Record<string, unknown>;
}

/**
 * Canonical error carrier for the AgentCompany main process.
 *
 * Subclasses below exist only so `instanceof RecoverableError` etc. work
 * ergonomically at call sites; the behavioural difference lives entirely
 * in `kind`.
 */
export class AppError extends Error {
  readonly kind: ErrorKind;
  readonly code: string;
  readonly context?: Record<string, unknown>;
  // Error has `cause` as optional since ES2022; we mirror it explicitly to
  // give a stable accessor regardless of lib version.
  readonly appCause: unknown;

  constructor(meta: AppErrorMeta) {
    super(meta.message);
    this.name = "AppError";
    this.kind = meta.kind;
    this.code = meta.code;
    this.context = meta.context;
    this.appCause = meta.cause;
  }

  /**
   * Structured envelope suitable for log lines or IPC payloads.
   */
  toJSON(): {
    name: string;
    kind: ErrorKind;
    code: string;
    message: string;
    context?: Record<string, unknown>;
    cause?: string;
  } {
    const payload: {
      name: string;
      kind: ErrorKind;
      code: string;
      message: string;
      context?: Record<string, unknown>;
      cause?: string;
    } = {
      name: this.name,
      kind: this.kind,
      code: this.code,
      message: this.message,
    };
    if (this.context) payload.context = this.context;
    if (this.appCause !== undefined) {
      payload.cause =
        this.appCause instanceof Error
          ? this.appCause.message
          : String(this.appCause);
    }
    return payload;
  }
}

export class RecoverableError extends AppError {
  constructor(meta: Omit<AppErrorMeta, "kind">) {
    super({ ...meta, kind: "recoverable" });
    this.name = "RecoverableError";
  }
}

export class UserInputError extends AppError {
  constructor(meta: Omit<AppErrorMeta, "kind">) {
    super({ ...meta, kind: "user_input" });
    this.name = "UserInputError";
  }
}

export class UpstreamError extends AppError {
  constructor(meta: Omit<AppErrorMeta, "kind">) {
    super({ ...meta, kind: "upstream" });
    this.name = "UpstreamError";
  }
}

export class FatalError extends AppError {
  constructor(meta: Omit<AppErrorMeta, "kind">) {
    super({ ...meta, kind: "fatal" });
    this.name = "FatalError";
  }
}

let rawStringifyFallbackWarned = false;

/**
 * Wrap an unknown thrown value into an AppError.
 *
 * Three cases, resolved in order:
 *
 *   1. `e` is already an AppError → return it unchanged. The original
 *      classification (often narrower than the caller's guess) wins.
 *   2. `e instanceof Error` → construct an AppError with the caller's
 *      fallback meta and attach `e` as `cause`. The original
 *      `Error.message` is preserved in the cause chain; `meta.message`
 *      wins at the AppError level because it's the site-specific
 *      description.
 *   3. anything else (string, number, plain object, undefined) →
 *      construct with fallback meta and stash the raw value in
 *      `context.raw` for debugging.
 *
 * The `fallback` argument is required on purpose: the call site is the
 * only place that knows the semantic intent of the surrounding code, so
 * it must commit to a kind/code/message. A silent default here would
 * reintroduce the exact "mystery-shaped error" problem this helper is
 * designed to eliminate.
 */
export function classifyUnknownError(
  e: unknown,
  fallback: AppErrorMeta,
): AppError {
  if (e instanceof AppError) {
    return e;
  }
  if (e instanceof Error) {
    return new AppError({
      ...fallback,
      cause: e,
    });
  }
  return new AppError({
    ...fallback,
    context: {
      ...(fallback.context ?? {}),
      raw: stringifyRaw(e),
    },
  });
}

function stringifyRaw(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch (error) {
    // The raw value is a cyclic / un-serialisable object. `String(value)`
    // falls back to "[object Object]" which is still better than losing
    // the fact that something was thrown.
    warnRawStringifyFallback(error);
    return String(value);
  }
}

function warnRawStringifyFallback(error: unknown): void {
  if (rawStringifyFallbackWarned) return;
  rawStringifyFallbackWarned = true;
  log.warn(
    "[errors] stringifyRaw failed; using String(value) for raw thrown value.",
    error instanceof Error ? error.message : String(error),
  );
}

/**
 * Convenience narrowing predicate. Intentional: avoids forcing every
 * consumer to re-import `AppError` just to write an `instanceof` guard.
 */
export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
