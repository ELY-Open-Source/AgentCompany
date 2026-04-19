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
/** Rough tokens-per-char estimator; good enough for gating. */
const CHARS_PER_TOKEN = 4;
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
 */
export function compactMessagesIfNeeded(messages: AgentMessage[]): CompactionOutcome {
  const estimatedTokens = estimateTokens(messages);
  if (estimatedTokens < COMPACTION_TRIGGER_TOKENS) {
    return { changed: false, messages: null };
  }
  if (messages.length <= RECENT_MESSAGE_TAIL + 1) {
    return { changed: false, messages: null };
  }

  const cutoff = messages.length - RECENT_MESSAGE_TAIL;
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
