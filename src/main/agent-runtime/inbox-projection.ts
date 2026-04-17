/**
 * Inbox projection — converts a stored AgentMessageRecord into a pi
 * AgentMessage (user role) so inter-agent communication enters the
 * recipient's transcript as natural conversation rather than a prompt
 * block re-rendered every turn.
 *
 * The projection is the single source of truth for how an inbound message
 * looks inside a recipient's context: `[Message from {sender}{· channel}]`
 * header, optional subject line, then the body. Content is normalized
 * (control characters stripped, oversized bodies truncated) via the same
 * helpers used by the legacy prompt-builder boundary.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AgentMessageRecord } from "@shared/types";

const MAX_MESSAGE_BODY_LENGTH = 4000;
const MAX_SUBJECT_LENGTH = 200;

export interface AgentDirectory {
  getAgentName(agentId: string): string;
}

/**
 * Strip control characters (except newlines/tabs) and collapse excessive
 * whitespace runs. Mirrors `message-normalize.ts#cleanText` to keep the
 * transcript resilient against garbage from upstream senders.
 */
function cleanText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/[ \t]{4,}/g, "  ")
    .trim();
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

function formatChannelLabel(record: AgentMessageRecord): string | null {
  if (record.channel === "direct") return null;
  if (record.channelTargetId) return `${record.channel}:${record.channelTargetId}`;
  return record.channel;
}

function resolveSenderLabel(
  record: AgentMessageRecord,
  directory: AgentDirectory,
): string {
  switch (record.senderKind) {
    case "human":
      // The board-reader virtual account is the only non-agent human sender
      // surfaced in practice; render it as "Board" so agents know where
      // strategic directives originate.
      if (record.fromAgentId === "__board__") return "Board";
      return "User";
    case "system":
      return "System";
    case "agent":
    default:
      return directory.getAgentName(record.fromAgentId);
  }
}

/**
 * Projects a stored `AgentMessageRecord` into a pi `AgentMessage`
 * (role: "user") suitable for appending to the recipient's session
 * transcript. `timestamp` carries the message's `createdAt` in
 * ms-since-epoch so transcript ordering aligns with wall-clock time.
 */
export function projectInboxMessageToPi(
  record: AgentMessageRecord,
  directory: AgentDirectory,
): AgentMessage {
  const senderLabel = resolveSenderLabel(record, directory);
  const channelLabel = formatChannelLabel(record);
  const header = channelLabel
    ? `[Message from ${senderLabel} · ${channelLabel}]`
    : `[Message from ${senderLabel}]`;

  const subject = record.subject ? truncate(cleanText(record.subject), MAX_SUBJECT_LENGTH) : "";
  const body = truncate(cleanText(record.body), MAX_MESSAGE_BODY_LENGTH);

  const parts: string[] = [header];
  if (subject.length > 0) parts.push(subject);
  if (body.length > 0) parts.push(body);
  const text = parts.join("\n\n");

  const timestamp = Date.parse(record.createdAt);
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
  } as AgentMessage;
}
