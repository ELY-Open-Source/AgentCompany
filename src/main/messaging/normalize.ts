/**
 * Message Normalization Layer
 *
 * Normalizes comments before they are injected into agent prompts.
 * Prevents malformed, empty, or excessively long content from degrading
 * model output quality. Inspired by Reference/src/utils/messages.ts.
 *
 * Applied at the prompt-builder boundary — the last point before content
 * enters the model's context window.
 *
 * Inter-agent messages no longer flow through a prompt block; they are
 * projected directly into the recipient's pi session transcript. See
 * `agent-runtime/inbox-projection.ts`.
 */

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
