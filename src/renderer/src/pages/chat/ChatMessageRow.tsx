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
import { t } from "../../i18n/i18n";

export function ChatMessageRow({
  message,
  attachments,
  mentions,
  slashInvocations,
  files,
  context,
  canModify = false,
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
  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = new FormData(event.currentTarget).get("body");
    const value = typeof next === "string" ? next.trim() : "";
    if (value && onEdit) onEdit(value);
    setEditing(false);
  };
  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
      <Avatar name={name} bot={bot} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row" style={{ alignItems: "baseline", gap: 8, marginBottom: 2 }}>
          <span style={{ fontSize: 14, fontWeight: 540 }}>{name}</span>
          <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>{formatTime(message.createdAt)}</span>
          {message.editedAt && !deleted && <span style={{ fontSize: 12, color: "var(--text-3)" }}>{t("(edited)")}</span>}
          {canModify && !editing && (
            <span style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
              <IconButton icon="edit" label={t("Edit message")} size={16} onClick={() => setEditing(true)} />
              <IconButton icon="x" label={t("Delete message")} size={16} onClick={onDelete} />
            </span>
          )}
        </div>
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
          <div style={{ fontSize: 14, color: "var(--text-1)", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
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
      </div>
    </div>
  );
}

function renderBody(body: string, mentions: ChatMentionRecord[], context: MessageContext): ReactNode {
  if (mentions.length === 0) return formatInline(body, "b");
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
    if (mention.offsetStart > lastIndex) parts.push(...formatInline(body.slice(lastIndex, mention.offsetStart), `s${lastIndex}`));
    const label = mentionLabel(mention, context);
    const failed = mention.wakeState === "failed";
    parts.push(
      <span
        key={`m-${mention.messageId}-${mention.offsetStart}`}
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
        @{label}
      </span>,
    );
    lastIndex = mention.offsetEnd;
  }
  if (lastIndex < body.length) parts.push(...formatInline(body.slice(lastIndex), `s${lastIndex}`));
  return parts;
}

/**
 * Renders the light markdown agents and people use in chat — **bold**, *italic*,
 * `code`, and [text](https://link) — into React nodes. Links are restricted to
 * http(s) and nothing is ever set as raw HTML, so message bodies stay inert. A
 * message with no markdown comes back as a single plain string.
 */
function formatInline(text: string, keyPrefix: string): ReactNode[] {
  const pattern = /(\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\))/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let token = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const key = `${keyPrefix}-${token++}`;
    if (match[2] !== undefined) nodes.push(<strong key={key}>{match[2]}</strong>);
    else if (match[3] !== undefined) nodes.push(<em key={key}>{match[3]}</em>);
    else if (match[4] !== undefined) nodes.push(<code key={key} className="mono" style={{ background: "var(--panel-3)", padding: "1px 5px", borderRadius: 4, fontSize: "0.92em" }}>{match[4]}</code>);
    else nodes.push(<a key={key} href={match[6]} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>{match[5]}</a>);
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
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
