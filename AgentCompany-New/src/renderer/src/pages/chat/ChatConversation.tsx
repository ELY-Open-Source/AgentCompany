import { useState, type FormEvent, type MutableRefObject } from "react";
import { AvatarStack, Icon, IconButton } from "../../shared/ui";
import type {
  ApprovalRecord,
  ChatAttachmentRecord,
  ChatMentionRecord,
  ChatMessageRecord,
  ChatSpaceRecord,
  ChatSlashInvocationRecord,
  ChatThreadRecord,
  FileObjectRecord,
} from "../../../../shared/domain";
import { ChatComposer } from "./ChatComposer";
import { ChatTimeline } from "./ChatTimeline";
import type { MessageContext } from "./chat-helpers";

export function ChatConversation({
  space,
  participants,
  rootMessages,
  messagesInSpace,
  threadsInSpace,
  pendingApprovals,
  attachments,
  mentions,
  slashInvocations,
  files,
  context,
  attachmentFileId,
  currentEmployeeId,
  onAttachmentChange,
  onAttach,
  onOpenThread,
  onApprove,
  onDecline,
  onEditMessage,
  onDeleteMessage,
  onOpenFile,
  onSubmit,
  composerRef,
}: {
  space: ChatSpaceRecord | null;
  participants: string[];
  rootMessages: ChatMessageRecord[];
  messagesInSpace: ChatMessageRecord[];
  threadsInSpace: ChatThreadRecord[];
  pendingApprovals: ApprovalRecord[];
  attachments: ChatAttachmentRecord[];
  mentions: ChatMentionRecord[];
  slashInvocations: ChatSlashInvocationRecord[];
  files: FileObjectRecord[];
  context: MessageContext;
  attachmentFileId: string;
  currentEmployeeId: string;
  onAttachmentChange: (next: string) => void;
  onAttach: () => void;
  onOpenThread: (threadId: string) => void;
  onApprove: (approvalId: string) => void;
  onDecline: (approvalId: string) => void;
  onEditMessage: (messageId: string, bodyMd: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onOpenFile: (fileId: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  composerRef: MutableRefObject<HTMLTextAreaElement | null>;
}) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim().toLowerCase();
  const filtered = trimmed
    ? messagesInSpace.filter((m) => m.bodyMd.toLowerCase().includes(trimmed))
    : messagesInSpace;
  return (
    <section style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "var(--panel)" }}>
      {space && <ConversationHeader space={space} participants={participants} query={query} onQueryChange={setQuery} />}
      <div style={{ flex: 1, overflow: "auto", padding: "20px 24px 8px" }}>
        {space && (
          <ChatTimeline
            rootMessages={[]}
            messagesInSpace={filtered}
            threadsInSpace={threadsInSpace}
            pendingApprovals={pendingApprovals}
            attachments={attachments}
            mentions={mentions}
            slashInvocations={slashInvocations}
            files={files}
            context={context}
            currentEmployeeId={currentEmployeeId}
            onOpenThread={onOpenThread}
            onApprove={onApprove}
            onDecline={onDecline}
            onEditMessage={onEditMessage}
            onDeleteMessage={onDeleteMessage}
            onOpenFile={onOpenFile}
          />
        )}
      </div>
      <ChatComposer
        disabled={!space}
        files={files}
        agents={context.agents}
        employees={context.employees}
        attachmentFileId={attachmentFileId}
        onAttachmentChange={onAttachmentChange}
        onAttach={onAttach}
        onSubmit={onSubmit}
        composerRef={composerRef}
      />
    </section>
  );
}

function ConversationHeader({
  space,
  participants,
  query,
  onQueryChange,
}: {
  space: ChatSpaceRecord;
  participants: string[];
  query: string;
  onQueryChange: (next: string) => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const toggleSearch = () => {
    setSearchOpen((open) => {
      if (open) onQueryChange("");
      return !open;
    });
  };
  return (
    <header className="row" style={{ height: 52, padding: "0 24px", borderBottom: "1px solid var(--border-soft)", flexShrink: 0 }}>
      <Icon name={space.visibility === "restricted" ? "lock" : "hash"} size={15} color="var(--text-3)" />
      <span style={{ fontSize: 14, fontWeight: 600 }}>{space.name}</span>
      <span
        style={{
          fontSize: 12,
          color: "var(--text-3)",
          borderLeft: "1px solid var(--border)",
          paddingLeft: 10,
          marginLeft: 4,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
          minWidth: 0,
        }}
      >
        {space.topic}
      </span>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
        {searchOpen && (
          <input
            className="input"
            autoFocus
            aria-label="Search messages"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") toggleSearch(); }}
            style={{ width: 200, height: 28, padding: "0 10px" }}
          />
        )}
        {!searchOpen && participants.length > 0 && <AvatarStack names={participants.slice(0, 5)} bot />}
        <IconButton icon="search" label="Search" onClick={toggleSearch} />
      </div>
    </header>
  );
}
