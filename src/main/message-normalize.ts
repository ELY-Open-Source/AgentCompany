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
