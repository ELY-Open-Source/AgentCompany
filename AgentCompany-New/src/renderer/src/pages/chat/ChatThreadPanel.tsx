import type { FormEvent } from "react";
import { Button, Icon, IconButton } from "../../shared/ui";
import type {
  ChatAttachmentRecord,
  ChatMessageRecord,
  FileObjectRecord,
} from "../../../../shared/domain";
import { formatTime } from "../types";
import { ChatMessageRow } from "./ChatMessageRow";
import { senderName, type MessageContext } from "./chat-helpers";

export function ChatThreadPanel({
  rootMessage,
  messages,
  attachments,
  files,
  context,
  onClose,
  onSubmit,
}: {
  rootMessage: ChatMessageRecord | null;
  messages: ChatMessageRecord[];
  attachments: ChatAttachmentRecord[];
  files: FileObjectRecord[];
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
            files={files}
            replyCount={0}
            onOpenThread={null}
            context={context}
            compact
          />
        ))}
      </div>
      <form onSubmit={onSubmit} style={{ padding: 12, flexShrink: 0 }}>
        <div style={{ border: "1px solid var(--border-strong)", borderRadius: 10, background: "var(--panel)", padding: "8px 10px" }}>
          <textarea
            name="message"
            rows={2}
            placeholder="Reply in thread…"
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
