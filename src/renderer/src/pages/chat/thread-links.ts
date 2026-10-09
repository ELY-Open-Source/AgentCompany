import type { ChatMessageRecord, ChatThreadRecord } from "../../../../shared/domain";
import { senderName, type MessageContext } from "./chat-helpers";
import { t } from "../../i18n/i18n";

/** How one message sits in its thread: which message it answers, and how many answers a thread root has. */
export interface ThreadLink {
  threadId: string;
  /** The root's author and first line; the author is null when the root is older than the loaded chat and only the thread title is known. */
  replyTo: { name: string | null; snippet: string } | null;
  replyCount: number;
}

const SNIPPET_CHARS = 80;

function snippet(message: ChatMessageRecord): string {
  if (message.deletedAt) return t("Message deleted");
  const line = message.bodyMd.split(/\r?\n/, 1)[0].trim();
  return line.length > SNIPPET_CHARS ? `${line.slice(0, SNIPPET_CHARS - 1)}…` : line;
}

/** Thread links for every threaded message in a conversation, keyed by message id. */
export function buildThreadLinks(messages: ChatMessageRecord[], threads: ChatThreadRecord[], context: MessageContext): Map<string, ThreadLink> {
  const rootOf = new Map(threads.map((thread) => [thread.id, thread.rootMessageId]));
  const titleOf = new Map(threads.map((thread) => [thread.id, thread.title]));
  const byId = new Map(messages.map((message) => [message.id, message]));
  const replies = new Map<string, number>();
  for (const message of messages) {
    if (message.threadId && rootOf.get(message.threadId) !== message.id) replies.set(message.threadId, (replies.get(message.threadId) ?? 0) + 1);
  }
  const links = new Map<string, ThreadLink>();
  for (const message of messages) {
    if (!message.threadId) continue;
    const rootId = rootOf.get(message.threadId);
    const root = rootId ? byId.get(rootId) : undefined;
    const isRoot = rootId === message.id;
    const title = titleOf.get(message.threadId);
    const replyTo = isRoot ? null : root ? { name: senderName(root, context), snippet: snippet(root) } : title !== undefined ? { name: null, snippet: title } : null;
    links.set(message.id, {
      threadId: message.threadId,
      replyTo,
      replyCount: isRoot ? replies.get(message.threadId) ?? 0 : 0,
    });
  }
  return links;
}
