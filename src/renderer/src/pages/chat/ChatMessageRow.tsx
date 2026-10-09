import { useState, type FormEvent, type ReactNode } from "react";
import { Avatar, Button, Icon, IconButton } from "../../shared/ui";
import type {
  ChatAttachmentRecord,
  ChatMentionRecord,
  ChatMessageRecord,
  ChatSlashInvocationRecord,
  FileObjectRecord,
} from "../../../../shared/domain";
import { formatTime } from "../types";
import { messageAttachments, senderName, type MessageContext } from "./chat-helpers";
import type { ThreadLink } from "./thread-links";
import { MessageMarkdown } from "./MessageMarkdown";
import type { ChatReplyStatus } from "../../../../shared/chat-domain";
import { t } from "../../i18n/i18n";

export function ChatMessageRow({
  message,
  attachments,
  mentions,
  slashInvocations,
  files,
  context,
  canModify = false,
  thread,
  replyStatuses = [],
  onOpenThread,
  onEdit,
  onDelete,
  onOpenFile,
}: {
  message: ChatMessageRecord;
  attachments: ChatAttachmentRecord[];
  mentions: ChatMentionRecord[];
  slashInvocations: ChatSlashInvocationRecord[];
  files: FileObjectRecord[];
  context: MessageContext;
  canModify?: boolean;
  /** Where the message sits in its thread; absent inside the thread view itself. */
  thread?: ThreadLink;
  /** Where each agent's reply to this message stands; a finished reply shows nothing. */
  replyStatuses?: ChatReplyStatus[];
  onOpenThread?: () => void;
  onEdit?: (bodyMd: string) => void;
  onDelete?: () => void;
  onOpenFile?: (fileId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const name = senderName(message, context);
  const bot = message.senderType === "agent";
  const deleted = Boolean(message.deletedAt);
  const messageFiles = deleted ? [] : messageAttachments(message.id, attachments, files);
  const messageMentions = mentions.filter((mention) => mention.messageId === message.id);
  const slashInvocation = deleted ? null : slashInvocations.find((invocation) => invocation.messageId === message.id) ?? null;
  const readers = bot || deleted ? [] : context.readersByMessage.get(message.id) ?? [];
  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = new FormData(event.currentTarget).get("body");
    const value = typeof next === "string" ? next.trim() : "";
    if (value && onEdit) onEdit(value);
    setEditing(false);
  };
  return (
    <div className="chat-message" style={{ display: "flex", gap: 12, marginBottom: 18 }}>
      <Avatar name={name} bot={bot} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row" style={{ alignItems: "baseline", gap: 8, marginBottom: 2 }}>
          <span style={{ fontSize: 14, fontWeight: 540 }}>{name}</span>
          <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>{formatTime(message.createdAt)}</span>
          {message.editedAt && !deleted && <span style={{ fontSize: 12, color: "var(--text-3)" }}>{t("(edited)")}</span>}
          {!editing && (canModify || (onOpenThread && !deleted)) && (
            <span style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
              {onOpenThread && !deleted && <IconButton icon="chat" label={t("Reply in thread")} size={16} onClick={onOpenThread} />}
              {canModify && <IconButton icon="edit" label={t("Edit message")} size={16} onClick={() => setEditing(true)} />}
              {canModify && <IconButton icon="x" label={t("Delete message")} size={16} onClick={onDelete} />}
            </span>
          )}
        </div>
        {thread?.replyTo && (
          <button
            type="button"
            aria-label={thread.replyTo.name === null
              ? t("Replying in thread: {snippet}", { snippet: thread.replyTo.snippet })
              : t("Replying to {name}: {snippet}", { name: thread.replyTo.name, snippet: thread.replyTo.snippet })}
            onClick={onOpenThread}
            style={{ display: "block", maxWidth: "100%", margin: "0 0 4px", padding: 0, border: 0, background: "transparent", color: "var(--text-3)", fontSize: 12, textAlign: "left", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            ↳ {thread.replyTo.name === null ? thread.replyTo.snippet : `${thread.replyTo.name}: ${thread.replyTo.snippet}`}
          </button>
        )}
        {slashInvocation && (
          <div className="pill mono" style={{ marginBottom: 6, width: "fit-content" }}>
            /{slashInvocation.command}
          </div>
        )}
        {deleted ? (
          <div style={{ fontSize: 14, color: "var(--text-3)", fontStyle: "italic" }}>{t("Message deleted")}</div>
        ) : editing ? (
          <form onSubmit={submitEdit}>
            <textarea
              name="body"
              defaultValue={message.bodyMd}
              autoFocus
              aria-label={t("Edit message")}
              className="input"
              style={{ minHeight: 60, marginBottom: 6 }}
            />
            <div className="row" style={{ gap: 6 }}>
              <Button tone="primary" size="small" type="submit">{t("Save")}</Button>
              <Button tone="ghost" size="small" onClick={() => setEditing(false)}>{t("Cancel")}</Button>
            </div>
          </form>
        ) : (
          <div style={{ fontSize: 14, color: "var(--text-1)", lineHeight: 1.5, wordBreak: "break-word" }}>
            {renderBody(message.bodyMd, messageMentions, context)}
          </div>
        )}
        {messageFiles.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            {messageFiles.map((file) => {
              const attachment = attachments.find((item) => item.messageId === message.id && item.fileId === file.id);
              const handoff = bot && attachment?.transferType === "handoff";
              return <AttachmentCard key={file.id} file={file} handoff={handoff} onOpen={onOpenFile ? () => onOpenFile(file.id) : null} />;
            })}
          </div>
        )}
        {thread && thread.replyCount > 0 && (
          <button type="button" onClick={onOpenThread} style={{ marginTop: 4, padding: 0, border: 0, background: "transparent", color: "var(--accent)", fontSize: 12, cursor: "pointer" }}>
            {thread.replyCount === 1 ? t("1 reply") : t("{count} replies", { count: String(thread.replyCount) })}
          </button>
        )}
        {replyStatuses.filter((status) => status.state !== "replied").map((status) => (
          <div key={`${status.agentId}-${status.state}`} role="status" style={{ fontSize: 12, color: status.state === "failed" || status.state === "expired" ? "var(--red)" : "var(--text-3)", marginTop: 4 }}>
            {replyStatusText(status, context)}
          </div>
        ))}
        {readers.length > 0 && (
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
            {t("Read by {names}", { names: readers.join(", ") })}
          </div>
        )}
      </div>
    </div>
  );
}

function replyStatusText(status: ChatReplyStatus, context: MessageContext): string {
  const agent = context.agents.find((item) => item.id === status.agentId)?.name ?? t("Former member");
  if (status.state === "queued") return t("{agent} will reply; queued.", { agent });
  if (status.state === "running") return t("{agent} is replying…", { agent });
  if (status.state === "waiting") {
    return status.resumesAt
      ? t("{agent} is waiting: {reason} Resumes {time}.", { agent, reason: status.detail, time: formatTime(status.resumesAt) })
      : t("{agent} is waiting: {reason}", { agent, reason: status.detail });
  }
  if (status.state === "expired") return t("{agent} did not reply: {reason}", { agent, reason: status.detail });
  if (status.state === "failed") return t("{agent}'s reply failed: {reason}", { agent, reason: status.detail });
  return t("{agent}'s reply was stopped.", { agent });
}

function renderBody(body: string, mentions: ChatMentionRecord[], context: MessageContext): ReactNode {
  const ordered = [...mentions].sort((a, b) => a.offsetStart - b.offsetStart);
  let lastIndex = 0;
  for (const mention of ordered) {
    if (mention.offsetStart < lastIndex) throw new Error("Message mention offsets overlap.");
    if (mention.offsetStart < 0 || mention.offsetEnd > body.length || mention.offsetStart >= mention.offsetEnd) {
      throw new Error("Message mention offset is invalid.");
    }
    if (!body.slice(mention.offsetStart, mention.offsetEnd).startsWith("@")) throw new Error("Message mention token is invalid.");
    lastIndex = mention.offsetEnd;
  }
  const renderMention = (index: number) => {
    const mention = ordered[index];
    const failed = mention.wakeState === "failed";
    return (
      <span
        title={failed ? t("Agent could not be reached") : undefined}
        style={{
          background: failed ? "rgba(255,100,80,0.1)" : "var(--accent-soft)",
          color: failed ? "var(--text-3)" : "var(--accent)",
          padding: "1px 5px",
          borderRadius: 4,
          fontWeight: 500,
          textDecoration: failed ? "line-through" : undefined,
        }}
      >
        @{mentionLabel(mention, context)}
      </span>
    );
  };
  return <MessageMarkdown body={body} mentions={ordered.map((mention) => ({ start: mention.offsetStart, end: mention.offsetEnd }))} renderMention={renderMention} />;
}

function mentionLabel(mention: ChatMentionRecord, context: MessageContext): string {
  // Degrade unresolvable targets to a placeholder instead of throwing: one
  // stale mention row must not blank the entire timeline.
  if (mention.targetType === "employee") {
    const employee = context.employees.find((item) => item.id === mention.targetId);
    return employee ? employee.displayName : t("Former member");
  }
  if (mention.targetType === "agent") {
    const agent = context.agents.find((item) => item.id === mention.targetId);
    return agent ? agent.name : t("Former member");
  }
  if (mention.targetType === "board") return t("Board");
  if (mention.targetType === "org_group" && mention.targetId.endsWith(":oncall")) return t("OnCall");
  return t("Former member");
}

function AttachmentCard({ file, handoff = false, onOpen }: { file: FileObjectRecord; handoff?: boolean; onOpen: (() => void) | null }) {
  const canOpen = onOpen !== null && file.scanState === "approved";
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
        <div className="row" style={{ gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 540, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
          {handoff && (
            <span className="pill violet" style={{ flexShrink: 0 }}>
              <Icon name="bot" size={10} /> {t("AI → AI")}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-3)" }}>{file.kind.toUpperCase()}</div>
      </div>
      {canOpen && <IconButton icon="arrowUpRight" label={t("Open {name}", { name: file.name })} onClick={onOpen ?? undefined} />}
    </div>
  );
}
