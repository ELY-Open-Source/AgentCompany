import type { ProviderObservedRateLimitState } from "../../shared/provider-runtime-domain";
import type { JsonRecord, ProviderEventStreamMessage } from "./provider-http";
import { isRecord } from "./provider-http";
import { FINISHED_STOP_REASONS, incompleteTurn } from "./provider-tool-turn";
import { incompleteReason } from "./provider-tool-turns/responses-format";

export interface ProviderStreamEvent {
  /** usage: a chunk that only reports token usage; it is recorded, never shown. */
  type: "message_start" | "text_delta" | "message_stop" | "error" | "usage";
  textDelta: string | null;
  providerResponseId: string | null;
  rawEventJson: string;
}

export interface ProviderStreamResult {
  events: AsyncIterable<ProviderStreamEvent>;
  rateLimitState: ProviderObservedRateLimitState | null;
}

export interface ProviderCancelResult {
  responseId: string;
  rawResponseJson: string;
  rateLimitState: ProviderObservedRateLimitState | null;
}

export async function* mapOpenAiResponseStream(messages: AsyncIterable<ProviderEventStreamMessage>): AsyncIterable<ProviderStreamEvent> {
  let started = false;
  for await (const message of messages) {
    const type = eventType(message);
    if (type === "response.created") {
      if (!started) {
        started = true;
        yield streamEvent("message_start", null, message);
      }
      continue;
    }
    if (type === "response.output_text.delta") {
      if (!started) {
        started = true;
        yield streamEvent("message_start", null, message);
      }
      const delta = stringField(message.data, "delta");
      if (delta) yield streamEvent("text_delta", delta, message);
      continue;
    }
    if (type === "response.incomplete") {
      const response = recordField(message.data, "response") ?? {};
      yield streamEvent("error", incompleteTurn(incompleteReason(response)).message, message);
      return;
    }
    if (type === "response.completed") {
      if (!started) {
        started = true;
        yield streamEvent("message_start", null, message);
      }
      yield streamEvent("message_stop", null, message);
      continue;
    }
    if (type === "response.failed" || type === "error") {
      yield streamEvent("error", readErrorText(message.data), message);
    }
  }
}

export async function* mapOpenAiChatCompletionStream(messages: AsyncIterable<ProviderEventStreamMessage>): AsyncIterable<ProviderStreamEvent> {
  let started = false;
  for await (const message of messages) {
    const delta = readChatDeltaContent(message.data);
    if (delta) {
      if (!started) {
        started = true;
        yield streamEvent("message_start", null, message);
      }
      yield streamEvent("text_delta", delta, message);
    }
    const finish = chatFinishReason(message.data);
    if (finish && !(FINISHED_STOP_REASONS.chat as readonly string[]).includes(finish)) {
      yield streamEvent("error", incompleteTurn(finish).message, message);
      return;
    }
    if (finish) {
      if (!started) {
        started = true;
        yield streamEvent("message_start", null, message);
      }
      yield streamEvent("message_stop", null, message);
    } else if (!delta && isRecord(message.data.usage)) {
      yield streamEvent("usage", null, message);
    }
  }
}

export async function* mapAnthropicMessageStream(messages: AsyncIterable<ProviderEventStreamMessage>): AsyncIterable<ProviderStreamEvent> {
  let started = false;
  for await (const message of messages) {
    const type = eventType(message);
    if (type === "message_start") {
      started = true;
      yield streamEvent("message_start", null, message);
      continue;
    }
    // Anthropic reports output tokens on message_delta, input tokens on message_start.
    if (type === "message_delta") {
      const stopReason = stringField(recordField(message.data, "delta") ?? {}, "stop_reason");
      if (stopReason && !(FINISHED_STOP_REASONS.anthropic as readonly string[]).includes(stopReason)) {
        yield streamEvent("error", incompleteTurn(stopReason).message, message);
        return;
      }
      yield streamEvent("usage", null, message);
      continue;
    }
    if (type === "content_block_delta") {
      const delta = readAnthropicTextDelta(message.data);
      if (delta) {
        if (!started) {
          started = true;
          yield streamEvent("message_start", null, message);
        }
        yield streamEvent("text_delta", delta, message);
      }
      continue;
    }
    if (type === "message_stop") {
      if (!started) {
        started = true;
        yield streamEvent("message_start", null, message);
      }
      yield streamEvent("message_stop", null, message);
      continue;
    }
    if (type === "error") yield streamEvent("error", readErrorText(message.data), message);
  }
}

export function streamUnsupported(providerLabel: string): () => Promise<ProviderStreamResult> {
  return async () => {
    throw new Error(`${providerLabel} streaming is unavailable.`);
  };
}

export function cancelUnsupported(providerLabel: string): () => Promise<ProviderCancelResult> {
  return async () => {
    throw new Error(`${providerLabel} response cancellation is unavailable.`);
  };
}

function streamEvent(type: ProviderStreamEvent["type"], textDelta: string | null, message: ProviderEventStreamMessage): ProviderStreamEvent {
  return { type, textDelta, providerResponseId: readProviderResponseId(message.data), rawEventJson: message.rawData };
}

function eventType(message: ProviderEventStreamMessage): string | null {
  const dataType = stringField(message.data, "type");
  return dataType ?? message.eventName;
}

function readChatDeltaContent(data: JsonRecord): string | null {
  for (const choice of recordArray(data.choices)) {
    const delta = recordField(choice, "delta");
    const content = delta ? stringField(delta, "content") : null;
    if (content) return content;
  }
  return null;
}

function chatFinishReason(data: JsonRecord): string | null {
  const reason = recordArray(data.choices).map((choice) => choice.finish_reason).find((value) => typeof value === "string" && value.length > 0);
  return typeof reason === "string" ? reason : null;
}

function readAnthropicTextDelta(data: JsonRecord): string | null {
  const delta = recordField(data, "delta");
  if (!delta) return null;
  return stringField(delta, "text");
}

function readErrorText(data: JsonRecord): string | null {
  const error = data.error;
  if (typeof error === "string") return error;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return null;
}

function readProviderResponseId(data: JsonRecord): string | null {
  const direct = stringField(data, "id") ?? stringField(data, "response_id");
  if (direct) return direct;
  const response = recordField(data, "response");
  return response ? stringField(response, "id") : null;
}

function stringField(record: JsonRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function recordField(record: JsonRecord, key: string): JsonRecord | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function recordArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}
