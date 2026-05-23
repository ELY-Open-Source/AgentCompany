import type { FormEvent } from "react";
import { Button, Icon, IconButton } from "../../shared/ui";
import type {
  AuditEventRecord,
  ChatAttachmentRecord,
  ChatMentionRecord,
  ChatMessageRecord,
  ChatSlashInvocationRecord,
  FileObjectRecord,
} from "../../../../shared/domain";
import { formatTime } from "../types";
import { ChatMessageRow } from "./ChatMessageRow";
import { senderName, type MessageContext } from "./chat-helpers";

export function ChatThreadPanel({
  rootMessage,
  messages,
  attachments,
  mentions,
  slashInvocations,
  files,
  auditEvents,
  context,
  onClose,
  onSubmit,
}: {
  rootMessage: ChatMessageRecord | null;
  messages: ChatMessageRecord[];
  attachments: ChatAttachmentRecord[];
  mentions: ChatMentionRecord[];
  slashInvocations: ChatSlashInvocationRecord[];
  files: FileObjectRecord[];
  auditEvents: AuditEventRecord[];
  context: MessageContext;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <aside
      style={{
        width: 320,
        flexShrink: 0,
        borderLeft: "1px solid var(--border-soft)",
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div className="row" style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-soft)", flexShrink: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>Thread</div>
        <div style={{ marginLeft: "auto" }}>
          <IconButton icon="x" label="Close thread" onClick={onClose} />
        </div>
      </div>
      <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
        {rootMessage && (
          <>
            <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 10 }}>
              {formatTime(rootMessage.createdAt)} · {senderName(rootMessage, context)}
            </div>
            <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, background: "var(--panel)", marginBottom: 16 }}>
              <ChatMessageRow
                message={rootMessage}
                attachments={attachments}
                mentions={mentions}
                slashInvocations={slashInvocations}
                files={files}
                replyCount={0}
                onOpenThread={null}
                context={context}
                compact
              />
            </div>
          </>
        )}
        {messages.map((message) => (
          <ChatMessageRow
            key={message.id}
            message={message}
            attachments={attachments}
            mentions={mentions}
            slashInvocations={slashInvocations}
            files={files}
            replyCount={0}
            onOpenThread={null}
            context={context}
            compact
          />
        ))}
        {auditEvents.length > 0 && <AuditReplay events={auditEvents} />}
      </div>
      <form onSubmit={onSubmit} style={{ padding: 12, flexShrink: 0 }}>
        <div style={{ border: "1px solid var(--border-strong)", borderRadius: 10, background: "var(--panel)", padding: "8px 10px" }}>
          <textarea
            name="message"
            rows={2}
            aria-label="Thread reply"
            style={{ width: "100%", border: 0, resize: "none", outline: "none", fontSize: 13, background: "transparent", padding: 0, minHeight: 36 }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="row" style={{ paddingTop: 6, justifyContent: "flex-end" }}>
            <Button tone="primary" size="small" type="submit"><Icon name="send" size={12} /> Reply</Button>
          </div>
        </div>
      </form>
    </aside>
  );
}

function AuditReplay({ events }: { events: AuditEventRecord[] }) {
  return (
    <section style={{ borderTop: "1px solid var(--border-soft)", marginTop: 18, paddingTop: 14 }}>
      <div className="section-label" style={{ marginBottom: 10 }}>Audit</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {events.map((event) => (
          <div
            key={event.id}
            className="row"
            style={{
              alignItems: "baseline",
              gap: 8,
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "8px 10px",
              background: "var(--panel)",
              minWidth: 0,
            }}
          >
            <span className="mono" style={{ fontSize: 11, color: "var(--text-3)", flexShrink: 0 }}>{formatTime(event.createdAt)}</span>
            <span style={{ fontSize: 12, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {event.entityType}.{event.action}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
