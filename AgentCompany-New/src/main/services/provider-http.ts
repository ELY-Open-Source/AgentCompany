import type { ProviderObservedRateLimitState } from "../../shared/provider-runtime-domain";
import { parseProviderRateLimitHeaders } from "./provider-rate-limit-registry";

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

const PROVIDER_REQUEST_TIMEOUT_MS = 60_000;

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly rateLimitState: ProviderObservedRateLimitState | null,
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

export function providerRateLimitStateFromError(error: unknown): ProviderObservedRateLimitState | null {
  return error instanceof ProviderHttpError ? error.rateLimitState : null;
}

export async function postJson(endpoint: string, headers: Record<string, string>, body: JsonRecord): Promise<ProviderJsonResponse> {
  return requestJson(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

export async function getJson(endpoint: string, headers: Record<string, string>): Promise<ProviderJsonResponse> {
  return requestJson(endpoint, { method: "GET", headers });
}

export async function postEventStream(
  endpoint: string,
  headers: Record<string, string>,
  body: JsonRecord,
): Promise<ProviderEventStreamResponse> {
  const response = await requestProvider(endpoint, {
    method: "POST",
    headers: {
      accept: "text/event-stream",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const rateLimitState = parseProviderRateLimitHeaders(response.headers);
  if (!response.ok) {
    const raw = await response.text();
    const data = parseProviderJson(raw, false);
    const message = readProviderError(data) ?? (raw.trim() || `Provider request failed with HTTP ${response.status}.`);
    throw new ProviderHttpError(message, rateLimitState);
  }
  if (!response.body) throw new ProviderHttpError("Provider returned an empty event stream.", rateLimitState);
  return { messages: readServerSentEvents(response.body), rateLimitState };
}

async function requestJson(endpoint: string, init: RequestInit): Promise<ProviderJsonResponse> {
  const response = await requestProvider(endpoint, init);
  const rateLimitState = parseProviderRateLimitHeaders(response.headers);
  const raw = await response.text();
  const data = parseProviderJson(raw, response.ok);
  if (!response.ok) {
    const message = readProviderError(data) ?? (raw.trim() || `Provider request failed with HTTP ${response.status}.`);
    throw new ProviderHttpError(message, rateLimitState);
  }
  return { data, rateLimitState };
}

async function requestProvider(endpoint: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(endpoint, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function* readServerSentEvents(body: ReadableStream<Uint8Array>): AsyncIterable<ProviderEventStreamMessage> {
  const decoder = new TextDecoder();
  const state: EventStreamParseState = { eventName: null, dataLines: [] };
  let lineBuffer = "";
  const reader = body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
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
  } finally {
    reader.releaseLock();
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

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface EventStreamParseState {
  eventName: string | null;
  dataLines: string[];
}
