import type { ReactNode } from "react";
import { Avatar, Icon, IconButton } from "../../shared/ui";
import type {
  ChatAttachmentRecord,
  ChatMessageRecord,
  FileObjectRecord,
} from "../../../../shared/domain";
import { formatTime } from "../types";
import { messageAttachments, senderName, type MessageContext } from "./chat-helpers";

export function ChatMessageRow({
  message,
  attachments,
  files,
  replyCount,
  onOpenThread,
  context,
  compact = false,
}: {
  message: ChatMessageRecord;
  attachments: ChatAttachmentRecord[];
  files: FileObjectRecord[];
  replyCount: number;
  onOpenThread: (() => void) | null;
  context: MessageContext;
  compact?: boolean;
}) {
  const name = senderName(message, context);
  const bot = message.senderType === "agent";
  const messageFiles = messageAttachments(message.id, attachments, files);
  return (
    <div style={{ display: "flex", gap: compact ? 10 : 12, marginBottom: compact ? 12 : 18 }}>
      <Avatar name={name} size={compact ? "sm" : ""} bot={bot} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row" style={{ alignItems: "baseline", gap: 8, marginBottom: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 540 }}>{name}</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{formatTime(message.createdAt)}</span>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-1)", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {renderBody(message.bodyMd)}
        </div>
        {messageFiles.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            {messageFiles.map((file) => <AttachmentCard key={file.id} file={file} />)}
          </div>
        )}
        {replyCount > 0 && onOpenThread && (
          <button
            type="button"
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
            <Icon name="chat" size={11} /> {replyCount} {replyCount === 1 ? "reply" : "replies"} →
          </button>
        )}
      </div>
    </div>
  );
}

function renderBody(body: string): ReactNode {
  const parts: ReactNode[] = [];
  const regex = /@([A-Za-z][A-Za-z0-9_-]{1,63})/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(body)) !== null) {
    if (match.index > lastIndex) parts.push(body.slice(lastIndex, match.index));
    parts.push(
      <span
        key={`m-${match.index}`}
        style={{ background: "var(--accent-soft)", color: "var(--accent)", padding: "1px 5px", borderRadius: 4, fontWeight: 500 }}
      >
        @{match[1]}
      </span>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < body.length) parts.push(body.slice(lastIndex));
  return parts;
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
