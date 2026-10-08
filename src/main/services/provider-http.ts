import type { ProviderObservedRateLimitState } from "../../shared/provider-runtime-domain";
import { parseProviderRateLimitHeaders } from "./provider-rate-limit-registry";
import { currentRunSignal, throwIfRunStopped } from "./run-control";

export type JsonRecord = Record<string, unknown>;

export interface ProviderJsonResponse {
  data: JsonRecord;
  rateLimitState: ProviderObservedRateLimitState | null;
}

export interface ProviderEventStreamMessage {
  eventName: string | null;
  data: JsonRecord;
  rawData: string;
}

export interface ProviderEventStreamResponse {
  messages: AsyncIterable<ProviderEventStreamMessage>;
  rateLimitState: ProviderObservedRateLimitState | null;
}

const HEADERS_TIMEOUT_MS = 60_000;
const BODY_TIMEOUT_MS = 300_000;
const STREAM_IDLE_TIMEOUT_MS = 60_000;

/** A non-streamed request sends headers only after the whole answer; wait as long as Node's fetch itself allows (five minutes). */
export const WHOLE_RESPONSE_WAIT: ProviderRequestTimeouts = { headersTimeoutMs: 300_000 };

export interface ProviderRequestTimeouts {
  headersTimeoutMs?: number;
  bodyTimeoutMs?: number;
  idleTimeoutMs?: number;
}

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly rateLimitState: ProviderObservedRateLimitState | null,
    /** HTTP status of the failed response; null when no response arrived. */
    readonly status: number | null = null,
    readonly timedOut = false,
    /** The provider's machine-readable error code (OpenAI code/type, Anthropic type, Google status, AWS error type). */
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

export function providerRateLimitStateFromError(error: unknown): ProviderObservedRateLimitState | null {
  return error instanceof ProviderHttpError ? error.rateLimitState : null;
}

export async function postJson(
  endpoint: string,
  headers: Record<string, string>,
  body: JsonRecord,
  timeouts: ProviderRequestTimeouts = {},
): Promise<ProviderJsonResponse> {
  return requestJson(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  }, timeouts);
}

export async function getJson(endpoint: string, headers: Record<string, string>): Promise<ProviderJsonResponse> {
  return requestJson(endpoint, { method: "GET", headers });
}

export async function postEventStream(
  endpoint: string,
  headers: Record<string, string>,
  body: JsonRecord,
  timeouts: ProviderRequestTimeouts = {},
): Promise<ProviderEventStreamResponse> {
  const controller = linkedController();
  const response = await withDeadline(controller, timeouts.headersTimeoutMs ?? HEADERS_TIMEOUT_MS, () => fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "text/event-stream",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  }));
  const rateLimitState = parseProviderRateLimitHeaders(response.headers);
  if (!response.ok) {
    const raw = await withDeadline(controller, timeouts.bodyTimeoutMs ?? BODY_TIMEOUT_MS, () => response.text());
    const data = parseProviderJson(raw, false);
    const message = readProviderError(data) ?? (raw.trim() || `Provider request failed with HTTP ${response.status}.`);
    throw new ProviderHttpError(message, rateLimitState, response.status, false, readProviderErrorCode(data, response.headers));
  }
  if (!response.body) throw new ProviderHttpError("Provider returned an empty event stream.", rateLimitState);
  return { messages: readServerSentEvents(response.body, timeouts.idleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS), rateLimitState };
}

async function requestJson(endpoint: string, init: RequestInit, timeouts: ProviderRequestTimeouts = {}): Promise<ProviderJsonResponse> {
  const controller = linkedController();
  const response = await withDeadline(controller, timeouts.headersTimeoutMs ?? HEADERS_TIMEOUT_MS, () => fetch(endpoint, { ...init, signal: controller.signal }));
  const rateLimitState = parseProviderRateLimitHeaders(response.headers);
  const raw = await withDeadline(controller, timeouts.bodyTimeoutMs ?? BODY_TIMEOUT_MS, () => response.text());
  const data = parseProviderJson(raw, response.ok);
  if (!response.ok) {
    const message = readProviderError(data) ?? (raw.trim() || `Provider request failed with HTTP ${response.status}.`);
    throw new ProviderHttpError(message, rateLimitState, response.status, false, readProviderErrorCode(data, response.headers));
  }
  return { data, rateLimitState };
}

/**
 * Runs one phase of a provider request under a hard deadline. The abort
 * controller covers the WHOLE request — a server that returns headers and
 * then stalls the body must not hang the caller, so the body read gets its
 * own (longer) deadline after the headers arrive.
 */
/** A request controller that also aborts when the operator stops the run it belongs to. */
function linkedController(): AbortController {
  const controller = new AbortController();
  const runSignal = currentRunSignal();
  if (runSignal?.aborted) controller.abort();
  else runSignal?.addEventListener("abort", () => controller.abort(), { once: true });
  return controller;
}

async function withDeadline<T>(controller: AbortController, timeoutMs: number, operation: () => Promise<T>): Promise<T> {
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation();
  } catch (error) {
    throwIfRunStopped();
    if (controller.signal.aborted) throw new ProviderHttpError("Provider request timed out.", null, null, true);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function* readServerSentEvents(
  body: ReadableStream<Uint8Array>,
  idleTimeoutMs: number = STREAM_IDLE_TIMEOUT_MS,
): AsyncIterable<ProviderEventStreamMessage> {
  const decoder = new TextDecoder();
  const state: EventStreamParseState = { eventName: null, dataLines: [] };
  let lineBuffer = "";
  const reader = body.getReader();
  try {
    for (;;) {
      const { value, done } = await readWithIdleDeadline(reader, idleTimeoutMs);
      if (done) break;
      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const message = parseServerSentEventLine(state, line);
        if (message) yield message;
      }
    }
    lineBuffer += decoder.decode();
    if (lineBuffer.length > 0) {
      const message = parseServerSentEventLine(state, lineBuffer);
      if (message) yield message;
    }
    const message = flushServerSentEvent(state);
    if (message) yield message;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/** A healthy event stream emits chunks continuously; a read that produces nothing within the idle window means the connection is dead. */
async function readWithIdleDeadline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleTimeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: NodeJS.Timeout | undefined;
  const idle = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProviderHttpError("Provider stream timed out.", null, null, true)), idleTimeoutMs);
  });
  try {
    return await Promise.race([reader.read(), idle]);
  } finally {
    clearTimeout(timer);
  }
}

function parseServerSentEventLine(state: EventStreamParseState, rawLine: string): ProviderEventStreamMessage | null {
  const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
  if (line === "") return flushServerSentEvent(state);
  if (line.startsWith(":")) return null;
  const separatorIndex = line.indexOf(":");
  const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
  const rawValue = separatorIndex === -1 ? "" : line.slice(separatorIndex + 1);
  const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
  if (field === "event") state.eventName = value;
  if (field === "data") state.dataLines.push(value);
  return null;
}

function flushServerSentEvent(state: EventStreamParseState): ProviderEventStreamMessage | null {
  if (state.dataLines.length === 0) {
    state.eventName = null;
    return null;
  }
  const rawData = state.dataLines.join("\n");
  const eventName = state.eventName;
  state.eventName = null;
  state.dataLines = [];
  if (rawData === "[DONE]") return null;
  return { eventName, data: parseProviderJson(rawData, true), rawData };
}

function parseProviderJson(raw: string, requireJson: boolean): JsonRecord {
  if (!raw.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    if (!requireJson) return {};
    throw error;
  }
  if (!isRecord(value)) throw new Error("Provider returned invalid JSON.");
  return value;
}

function readProviderError(data: JsonRecord): string | null {
  const error = data.error;
  if (typeof error === "string") return error;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return null;
}

/** A failed HTTP exchange outside the request helpers (OAuth refresh, token minting), with its status and provider code. */
export function httpFailure(message: string, response: { status: number; headers: Headers }, text: string): ProviderHttpError {
  let data: JsonRecord = {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed)) data = parsed;
  } catch {
    data = {};
  }
  return new ProviderHttpError(message, parseProviderRateLimitHeaders(response.headers), response.status, false, readProviderErrorCode(data, response.headers));
}

/** The provider's error code: an error object's code, type or status, OAuth's error token, or AWS's error type. */
export function readProviderErrorCode(data: JsonRecord, headers?: Headers): string | null {
  const error = data.error;
  // OAuth (RFC 6749 5.2) puts the code itself in `error`; a sentence there is a message, not a code.
  if (typeof error === "string" && /^[A-Za-z0-9_.-]+$/.test(error)) return error;
  if (isRecord(error)) {
    for (const key of ["code", "type", "status"]) {
      const value = error[key];
      if (typeof value === "string" && value) return value;
    }
  }
  const awsType = headers?.get("x-amzn-errortype") ?? (typeof data.__type === "string" ? data.__type : null);
  return awsType ? awsType.split(":")[0].split("#").pop() ?? null : null;
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface EventStreamParseState {
  eventName: string | null;
  dataLines: string[];
}
