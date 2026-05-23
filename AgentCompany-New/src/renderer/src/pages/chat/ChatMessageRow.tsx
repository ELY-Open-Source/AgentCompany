import type { ReactNode } from "react";
import { Avatar, Icon, IconButton } from "../../shared/ui";
import type {
  ChatAttachmentRecord,
  ChatMentionRecord,
  ChatMessageRecord,
  ChatSlashInvocationRecord,
  FileObjectRecord,
} from "../../../../shared/domain";
import { formatTime } from "../types";
import { messageAttachments, senderName, type MessageContext } from "./chat-helpers";

export function ChatMessageRow({
  message,
  attachments,
  mentions,
  slashInvocations,
  files,
  replyCount,
  onOpenThread,
  context,
  compact = false,
}: {
  message: ChatMessageRecord;
  attachments: ChatAttachmentRecord[];
  mentions: ChatMentionRecord[];
  slashInvocations: ChatSlashInvocationRecord[];
  files: FileObjectRecord[];
  replyCount: number;
  onOpenThread: (() => void) | null;
  context: MessageContext;
  compact?: boolean;
}) {
  const name = senderName(message, context);
  const bot = message.senderType === "agent";
  const messageFiles = messageAttachments(message.id, attachments, files);
  const messageMentions = mentions.filter((mention) => mention.messageId === message.id);
  const slashInvocation = slashInvocations.find((invocation) => invocation.messageId === message.id) ?? null;
  return (
    <div style={{ display: "flex", gap: compact ? 10 : 12, marginBottom: compact ? 12 : 18 }}>
      <Avatar name={name} size={compact ? "sm" : ""} bot={bot} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row" style={{ alignItems: "baseline", gap: 8, marginBottom: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 540 }}>{name}</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{formatTime(message.createdAt)}</span>
        </div>
        {slashInvocation && (
          <div className="pill mono" style={{ marginBottom: 6, width: "fit-content" }}>
            /{slashInvocation.command}
          </div>
        )}
        <div style={{ fontSize: 13, color: "var(--text-1)", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {renderBody(message.bodyMd, messageMentions, context)}
        </div>
        {messageFiles.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            {messageFiles.map((file) => <AttachmentCard key={file.id} file={file} />)}
          </div>
        )}
        {onOpenThread && (
          <button
            type="button"
            aria-label="Open thread"
            onClick={onOpenThread}
            style={{
              marginTop: 8,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11.5,
              color: "var(--accent)",
              cursor: "pointer",
              padding: "3px 8px",
              borderRadius: 6,
              background: "var(--accent-soft)",
              border: 0,
            }}
          >
            <Icon name="chat" size={11} /> {replyCount > 0 ? `${replyCount} ${replyCount === 1 ? "reply" : "replies"}` : "Thread"} →
          </button>
        )}
      </div>
    </div>
  );
}

function renderBody(body: string, mentions: ChatMentionRecord[], context: MessageContext): ReactNode {
  if (mentions.length === 0) return body;
  const parts: ReactNode[] = [];
  const ordered = [...mentions].sort((a, b) => a.offsetStart - b.offsetStart);
  let lastIndex = 0;
  for (const mention of ordered) {
    if (mention.offsetStart < lastIndex) throw new Error("Message mention offsets overlap.");
    if (mention.offsetStart < 0 || mention.offsetEnd > body.length || mention.offsetStart >= mention.offsetEnd) {
      throw new Error("Message mention offset is invalid.");
    }
    const token = body.slice(mention.offsetStart, mention.offsetEnd);
    if (!token.startsWith("@")) throw new Error("Message mention token is invalid.");
    if (mention.offsetStart > lastIndex) parts.push(body.slice(lastIndex, mention.offsetStart));
    const label = mentionLabel(mention, context);
    parts.push(
      <span
        key={`m-${mention.messageId}-${mention.offsetStart}`}
        style={{ background: "var(--accent-soft)", color: "var(--accent)", padding: "1px 5px", borderRadius: 4, fontWeight: 500 }}
      >
        @{label}
      </span>,
    );
    lastIndex = mention.offsetEnd;
  }
  if (lastIndex < body.length) parts.push(body.slice(lastIndex));
  return parts;
}

function mentionLabel(mention: ChatMentionRecord, context: MessageContext): string {
  if (mention.targetType === "employee") {
    const employee = context.employees.find((item) => item.id === mention.targetId);
    if (!employee) throw new Error("Message mention employee target is missing.");
    return employee.displayName;
  }
  if (mention.targetType === "agent") {
    const agent = context.agents.find((item) => item.id === mention.targetId);
    if (!agent) throw new Error("Message mention agent target is missing.");
    return agent.name;
  }
  if (mention.targetType === "board") return "Board";
  if (mention.targetType === "org_group" && mention.targetId.endsWith(":oncall")) return "OnCall";
  throw new Error("Message mention target type is unsupported.");
}

function AttachmentCard({ file }: { file: FileObjectRecord }) {
  return (
    <div
      style={{
        maxWidth: 360,
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 10,
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "var(--panel)",
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          background: "var(--panel-3)",
          color: "var(--text-2)",
          display: "grid",
          placeItems: "center",
        }}
      >
        <Icon name={file.kind === "folder" ? "folder" : "file"} size={16} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 540, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</div>
        <div style={{ fontSize: 11, color: "var(--text-3)" }}>{file.kind.toUpperCase()} · {file.sha256.slice(0, 8)}</div>
      </div>
      <IconButton icon="arrowUpRight" label="Open" />
    </div>
  );
}
