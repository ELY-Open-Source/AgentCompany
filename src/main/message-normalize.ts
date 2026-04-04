/**
 * Message Normalization Layer
 *
 * Normalizes messages and comments before they are injected into agent prompts.
 * Prevents malformed, empty, or excessively long content from degrading
 * model output quality. Inspired by Reference/src/utils/messages.ts.
 *
 * Applied at the prompt-builder boundary — the last point before content
 * enters the model's context window.
 */

import type { AgentMessageRecord } from "@shared/types";

/** Maximum body length for a single message in prompt context. */
const MAX_MESSAGE_BODY_LENGTH = 800;

/** Maximum comment body length in prompt context. */
const MAX_COMMENT_BODY_LENGTH = 500;

/**
 * Strip control characters (except newlines/tabs) and collapse
 * excessive whitespace runs into single spaces.
 */
function cleanText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/[ \t]{4,}/g, "  ")
    .trim();
}

/**
 * Truncate text to maxLen, appending "…" if truncated.
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

/**
 * Normalize agent messages before prompt injection.
 * - Removes empty-body messages
 * - Cleans control characters
 * - Truncates overly long bodies
 * - Deduplicates consecutive identical messages from the same sender
 */
export function normalizeMessagesForPrompt(
  messages: AgentMessageRecord[],
  limit: number = 15,
): AgentMessageRecord[] {
  const result: AgentMessageRecord[] = [];
  let prevKey = "";

  for (const msg of messages) {
    const cleaned = cleanText(msg.body);
    if (cleaned.length === 0) continue;

    // Deduplicate consecutive identical messages from the same sender
    const key = `${msg.fromAgentId}:${cleaned}`;
    if (key === prevKey) continue;
    prevKey = key;

    result.push({
      ...msg,
      body: truncate(cleaned, MAX_MESSAGE_BODY_LENGTH),
      subject: msg.subject ? truncate(cleanText(msg.subject), 120) : msg.subject,
    });

    if (result.length >= limit) break;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Transcript Repair — for session handoff / resume scenarios
// Inspired by Reference/src/utils/messages.ts tool pairing logic.
// Applied when session state is restored, not at every message send.
// ---------------------------------------------------------------------------

/**
 * A transcript entry from adapter session state.
 * Adapters serialize their conversation as arrays of these blocks.
 */
export interface TranscriptBlock {
  role: "user" | "assistant" | "system";
  content: string | TranscriptContentBlock[];
}

export interface TranscriptContentBlock {
  type: string;
  id?: string;
  tool_use_id?: string;
  name?: string;
  input?: unknown;
  content?: string;
  text?: string;
}

/**
 * Repair tool_use / tool_result pairing in a serialized transcript.
 * - Orphan tool_results (no matching tool_use) are removed.
 * - Unpaired tool_use blocks get a synthetic "[interrupted]" result appended.
 * - Duplicate tool_use IDs are deduplicated (keep first).
 *
 * Returns a repaired copy; does not mutate the input.
 */
export function repairToolPairing(transcript: TranscriptBlock[]): TranscriptBlock[] {
  const toolUseIds = new Set<string>();
  const toolResultIds = new Set<string>();

  // Pass 1: collect all tool_use and tool_result IDs
  for (const block of transcript) {
    if (!Array.isArray(block.content)) continue;
    for (const part of block.content) {
      if (part.type === "tool_use" && part.id) {
        toolUseIds.add(part.id);
      }
      if (part.type === "tool_result" && part.tool_use_id) {
        toolResultIds.add(part.tool_use_id);
      }
    }
  }

  // Pass 2: filter orphan tool_results and deduplicate tool_use IDs
  const seenToolUseIds = new Set<string>();
  const repaired: TranscriptBlock[] = [];

  for (const block of transcript) {
    if (typeof block.content === "string") {
      repaired.push(block);
      continue;
    }

    const filteredContent: TranscriptContentBlock[] = [];
    for (const part of block.content) {
      if (part.type === "tool_result" && part.tool_use_id && !toolUseIds.has(part.tool_use_id)) {
        continue; // orphan tool_result — remove
      }
      if (part.type === "tool_use" && part.id) {
        if (seenToolUseIds.has(part.id)) continue; // duplicate — remove
        seenToolUseIds.add(part.id);
      }
      filteredContent.push(part);
    }

    if (filteredContent.length > 0) {
      repaired.push({ ...block, content: filteredContent });
    }
  }

  // Pass 3: add synthetic results for unpaired tool_use blocks
  const unpairedToolUseIds = [...toolUseIds].filter((id) => !toolResultIds.has(id));
  if (unpairedToolUseIds.length > 0) {
    const syntheticResults: TranscriptContentBlock[] = unpairedToolUseIds.map((id) => ({
      type: "tool_result",
      tool_use_id: id,
      content: "[interrupted — tool call did not complete before session ended]",
    }));
    repaired.push({
      role: "user",
      content: syntheticResults,
    });
  }

  return repaired;
}

/**
 * Validate and return repair statistics for a transcript.
 * Use for logging/diagnostics without modifying the transcript.
 */
export function diagnoseTranscript(transcript: TranscriptBlock[]): {
  totalBlocks: number;
  toolUseCount: number;
  toolResultCount: number;
  orphanResultCount: number;
  unpairedUseCount: number;
} {
  const toolUseIds = new Set<string>();
  const toolResultIds = new Set<string>();
  let toolUseCount = 0;
  let toolResultCount = 0;

  for (const block of transcript) {
    if (!Array.isArray(block.content)) continue;
    for (const part of block.content) {
      if (part.type === "tool_use" && part.id) {
        toolUseIds.add(part.id);
        toolUseCount++;
      }
      if (part.type === "tool_result" && part.tool_use_id) {
        toolResultIds.add(part.tool_use_id);
        toolResultCount++;
      }
    }
  }

  const orphanResultCount = [...toolResultIds].filter((id) => !toolUseIds.has(id)).length;
  const unpairedUseCount = [...toolUseIds].filter((id) => !toolResultIds.has(id)).length;

  return {
    totalBlocks: transcript.length,
    toolUseCount,
    toolResultCount,
    orphanResultCount,
    unpairedUseCount,
  };
}

export interface CommentRecord {
  taskId: string;
  taskTitle: string;
  authorName: string;
  body: string;
  createdAt: string;
}

/**
 * Normalize task comments before prompt injection.
 * - Removes empty-body comments
 * - Cleans control characters
 * - Truncates overly long bodies
 * - Deduplicates consecutive identical comments
 */
export function normalizeCommentsForPrompt(
  comments: CommentRecord[],
  limit: number = 10,
): CommentRecord[] {
  const result: CommentRecord[] = [];
  let prevKey = "";

  for (const comment of comments) {
    const cleaned = cleanText(comment.body);
    if (cleaned.length === 0) continue;

    const key = `${comment.taskId}:${comment.authorName}:${cleaned}`;
    if (key === prevKey) continue;
    prevKey = key;

    result.push({
      ...comment,
      body: truncate(cleaned, MAX_COMMENT_BODY_LENGTH),
    });

    if (result.length >= limit) break;
  }

  return result;
}
