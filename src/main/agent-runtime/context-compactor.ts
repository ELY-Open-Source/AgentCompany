/**
 * Deterministic pi context compactor.
 *
 * pi's `transformContext` hook runs before each LLM call and returns
 * the message list that will actually be sent. A long-running agent
 * can accumulate hundreds of messages — if we forward every one on
 * every call we pay per-token for the whole history, and large models
 * throttle when the context approaches their window.
 *
 * This compactor keeps the hook pure and provider-free: no LLM
 * round-trip, no mutation, no IO. It estimates token count using a
 * 4-chars-per-token heuristic, keeps recent traffic verbatim, and
 * collapses older messages into a single "context summary" user turn
 * that preserves the assistant's narrative plus tool-call headlines.
 *
 * Triggering only when the estimate clears the threshold means short
 * runs pay nothing; long runs see roughly constant per-call cost once
 * they cross the threshold.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";

/** Token-budget threshold that triggers compaction. */
const COMPACTION_TRIGGER_TOKENS = 120_000;
/**
 * Number of recent messages preserved verbatim. The tail must include
 * the current turn plus enough context for the agent to answer without
 * losing mid-stream state (tool-call pairs, user intent).
 */
const RECENT_MESSAGE_TAIL = 20;
/**
 * Conservative tokens-per-char estimator. The former 4 chars/token value
 * under-counts CJK traffic by roughly 2x — Chinese BPE tokenizers land
 * closer to 1.5-2 tokens per character, so a 120k-token gate would
 * silently trip only after the real context already blew past the
 * window. 2 chars/token is a deliberate over-estimate for latin text in
 * exchange for not under-triggering on Chinese agent runs. The proper
 * fix is a real tokenizer — pi-ai 0.67.68 does not export one yet, so
 * see docs/proposals/C3-real-tokenizer-followup.md for the upgrade path.
 */
const CHARS_PER_TOKEN = 2;
/** Per-assistant-message summary cap to keep the compacted turn readable. */
const MAX_SUMMARY_CHARS_PER_MESSAGE = 160;

interface MessageLike {
  role?: string;
  content?: unknown;
  timestamp?: number;
}

export interface CompactionOutcome {
  changed: boolean;
  messages: AgentMessage[] | null;
}

/**
 * Returns a compacted message list when the incoming transcript
 * exceeds the budget, or `{ changed: false }` when no compaction is
 * needed. The transformContext hook forwards the result verbatim.
 *
 * Cutoff must land on a user-turn boundary so we never orphan a
 * `toolResult` from its originating assistant `toolCall`. pi-ai's
 * message shape pairs assistant-with-toolCall blocks against standalone
 * `{ role: "toolResult", toolCallId }` messages — cutting mid-pair
 * would leave the provider with a dangling id and crash the next call.
 * When no safe boundary exists within reach, we decline to compact and
 * let the upstream token budget handle it.
 */
export function compactMessagesIfNeeded(messages: AgentMessage[]): CompactionOutcome {
  const estimatedTokens = estimateTokens(messages);
  if (estimatedTokens < COMPACTION_TRIGGER_TOKENS) {
    return { changed: false, messages: null };
  }
  if (messages.length <= RECENT_MESSAGE_TAIL + 1) {
    return { changed: false, messages: null };
  }

  const desiredCutoff = messages.length - RECENT_MESSAGE_TAIL;
  const cutoff = findSafeCutoff(messages, desiredCutoff);
  if (cutoff === null) {
    return { changed: false, messages: null };
  }

  const older = messages.slice(0, cutoff);
  const recent = messages.slice(cutoff);

  const summaryText = buildSummaryText(older);
  const summary: AgentMessage = {
    role: "user",
    content: [{ type: "text", text: summaryText }],
    timestamp: Date.now(),
  } as AgentMessage;

  return { changed: true, messages: [summary, ...recent] };
}

/**
 * Walk back from `desiredCutoff` until we find an index where the
 * message at that position starts a clean user turn. A user turn is
 * identifiable by `role === "user"`; anything else (`assistant`,
 * `toolResult`, or custom app message) can reference or be referenced
 * by neighbouring messages and must stay grouped.
 *
 * Returns `null` when no safe boundary exists in [1, desiredCutoff] —
 * e.g. an entirely tool-chained transcript. Returning null signals "do
 * not compact"; callers must pass the transcript through unchanged.
 */
function findSafeCutoff(messages: AgentMessage[], desiredCutoff: number): number | null {
  for (let i = desiredCutoff; i >= 1; i--) {
    const raw = messages[i] as MessageLike | undefined;
    if (raw && raw.role === "user") {
      return i;
    }
  }
  return null;
}

function estimateTokens(messages: AgentMessage[]): number {
  let total = 0;
  for (const message of messages) {
    total += estimateMessageTokens(message);
  }
  return total;
}

function estimateMessageTokens(message: AgentMessage): number {
  const raw = extractTextForEstimate(message as MessageLike);
  return Math.ceil(raw.length / CHARS_PER_TOKEN);
}

function extractTextForEstimate(message: MessageLike): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const obj = block as { type?: string; text?: string; thinking?: string; name?: string };
    if (typeof obj.text === "string") parts.push(obj.text);
    else if (typeof obj.thinking === "string") parts.push(obj.thinking);
    else if (obj.type === "toolCall" && typeof obj.name === "string") parts.push(`tool:${obj.name}`);
  }
  return parts.join(" ");
}

function buildSummaryText(older: AgentMessage[]): string {
  const lines: string[] = [
    "[Context summary — older turns compacted to stay within the token budget]",
    "",
  ];
  const firstUserText = findFirstUserPrompt(older);
  if (firstUserText) {
    lines.push(`Original task: ${truncate(firstUserText, 200)}`);
    lines.push("");
  }
  const assistantPoints = collectAssistantHighlights(older);
  if (assistantPoints.length > 0) {
    lines.push("Key turns:");
    for (const point of assistantPoints) {
      lines.push(`- ${point}`);
    }
  }
  lines.push("");
  lines.push(`(${older.length} earlier message${older.length === 1 ? "" : "s"} compacted.)`);
  return lines.join("\n");
}

function findFirstUserPrompt(messages: AgentMessage[]): string | null {
  for (const message of messages) {
    const raw = message as MessageLike;
    if (raw.role !== "user") continue;
    const text = extractTextForEstimate(raw).trim();
    if (text.length > 0) return text;
  }
  return null;
}

function collectAssistantHighlights(messages: AgentMessage[]): string[] {
  const highlights: string[] = [];
  for (const message of messages) {
    const raw = message as MessageLike;
    if (raw.role !== "assistant") continue;
    const text = extractTextForEstimate(raw).trim();
    if (text.length === 0) continue;
    highlights.push(truncate(firstSentence(text), MAX_SUMMARY_CHARS_PER_MESSAGE));
    if (highlights.length >= 12) break;
  }
  return highlights;
}

function firstSentence(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  const sentenceEnd = collapsed.search(/[.?!](\s|$)/);
  if (sentenceEnd > 0) return collapsed.slice(0, sentenceEnd + 1);
  return collapsed;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1).trimEnd() + "…";
}
