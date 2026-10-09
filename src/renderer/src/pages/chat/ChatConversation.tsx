import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type MutableRefObject } from "react";
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
import { ChatComposer, type Draft, type SendState } from "./ChatComposer";
import { ChatTimeline } from "./ChatTimeline";
import { ThreadPanel } from "./ThreadPanel";
import { buildThreadLinks } from "./thread-links";
import type { MessageContext } from "./chat-helpers";
import { t } from "../../i18n/i18n";

export function ChatConversation({
  space,
  participants,
  messagesInSpace,
  threads,
  pendingApprovals,
  attachments,
  mentions,
  slashInvocations,
  files,
  context,
  draft,
  attachError,
  onDraftLeave,
  currentEmployeeId,
  onAttachmentRemove,
  onAttach,
  onApprove,
  onDecline,
  onEditMessage,
  onDeleteMessage,
  onOpenFile,
  onSubmit,
  onRead,
  onReplyInThread,
  send,
  composerRef,
}: {
  space: ChatSpaceRecord | null;
  participants: string[];
  messagesInSpace: ChatMessageRecord[];
  threads: ChatThreadRecord[];
  pendingApprovals: ApprovalRecord[];
  attachments: ChatAttachmentRecord[];
  mentions: ChatMentionRecord[];
  slashInvocations: ChatSlashInvocationRecord[];
  files: FileObjectRecord[];
  context: MessageContext;
  draft: Draft;
  attachError: string | null;
  onDraftLeave: (spaceId: string, body: string) => void;
  currentEmployeeId: string;
  onAttachmentRemove: (fileId: string) => void;
  onAttach: () => void;
  onApprove: (approvalId: string) => void;
  onDecline: (approvalId: string) => void;
  onEditMessage: (messageId: string, bodyMd: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onOpenFile: (fileId: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** Marks the conversation read up to a message the reader has in view; must be stable. */
  onRead: (spaceId: string, upToMessageId: string) => void;
  onReplyInThread: (threadId: string, body: string) => Promise<void>;
  send: SendState;
  composerRef: MutableRefObject<HTMLTextAreaElement | null>;
}) {
  const [query, setQuery] = useState("");
  // The component is keyed by space, so an open thread closes when the conversation changes.
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const threadLinks = useMemo(() => buildThreadLinks(messagesInSpace, threads, context), [messagesInSpace, threads, context]);
  const trimmed = query.trim().toLowerCase();
  const filtered = trimmed
    ? messagesInSpace.filter((m) => m.bodyMd.toLowerCase().includes(trimmed))
    : messagesInSpace;

  // Messenger scroll contract: open at the latest message, stay pinned there
  // while the reader is at the bottom, and offer a jump back the moment they
  // scroll up into history.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const lastMessageId = filtered.length > 0 ? filtered[filtered.length - 1].id : null;

  const measureAtBottom = () => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };
  const onScroll = () => {
    const near = measureAtBottom();
    atBottomRef.current = near;
    setAtBottom(near);
  };
  const jumpToLatest = (behavior: ScrollBehavior) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  };

  // The component is keyed by space, so mount = opening this conversation.
  useLayoutEffect(() => {
    jumpToLatest("auto");
  }, []);
  // New messages keep a bottom-pinned reader pinned; a reader up in history
  // is left alone (the jump pill is their way back).
  useLayoutEffect(() => {
    if (atBottomRef.current) jumpToLatest("auto");
  }, [lastMessageId]);

  // Read means seen: the newest message is in view, the window is visible, and no search hides messages.
  const newestId = messagesInSpace.length > 0 ? messagesInSpace[messagesInSpace.length - 1].id : null;
  const spaceId = space?.id ?? null;
  const searching = trimmed.length > 0;
  useEffect(() => {
    const markIfSeen = () => {
      // The DOM is measured, not the last scroll state: clearing a search can grow the list under a reader who was at the bottom.
      if (spaceId && newestId && !searching && measureAtBottom() && document.visibilityState === "visible") onRead(spaceId, newestId);
    };
    markIfSeen();
    document.addEventListener("visibilitychange", markIfSeen);
    return () => document.removeEventListener("visibilitychange", markIfSeen);
  }, [spaceId, newestId, atBottom, searching, onRead]);

  return (
    <>
      <section style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "var(--panel)" }}>
        {space && <ConversationHeader space={space} participants={participants} query={query} onQueryChange={setQuery} />}
        <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div
            ref={scrollRef}
            onScroll={onScroll}
            role="log"
            aria-label={t("Conversation messages")}
            style={{ flex: 1, overflow: "auto", padding: "20px 24px 8px" }}
          >
            {space && (
              <ChatTimeline
                key={space.id}
                messagesInSpace={filtered}
                pendingApprovals={pendingApprovals}
                attachments={attachments}
                mentions={mentions}
                slashInvocations={slashInvocations}
                files={files}
                context={context}
                currentEmployeeId={currentEmployeeId}
                threadLinks={threadLinks}
                onOpenThread={setOpenThreadId}
                onApprove={onApprove}
                onDecline={onDecline}
                onEditMessage={onEditMessage}
                onDeleteMessage={onDeleteMessage}
                onOpenFile={onOpenFile}
              />
            )}
          </div>
          {!atBottom && (
            <button type="button" className="jump-latest" onClick={() => jumpToLatest("smooth")}>
              <span aria-hidden style={{ fontSize: 13, lineHeight: 1 }}>↓</span>
              {t("Jump to latest")}
            </button>
          )}
        </div>
        <ChatComposer
          disabled={!space}
          send={send}
          files={files}
          agents={context.agents}
          employees={context.employees}
          draft={draft}
          attachError={attachError}
          spaceId={space?.id ?? null}
          onLeave={onDraftLeave}
          onAttachmentRemove={onAttachmentRemove}
          onAttach={onAttach}
          onSubmit={onSubmit}
          composerRef={composerRef}
        />
      </section>
      {openThreadId && space && (
        <ThreadPanel
          key={openThreadId}
          orgId={space.orgId}
          threadId={openThreadId}
          refreshKey={messagesInSpace}
          files={files}
          context={context}
          onReply={(body) => onReplyInThread(openThreadId, body)}
          onClose={() => setOpenThreadId(null)}
          onOpenFile={onOpenFile}
        />
      )}
    </>
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
            aria-label={t("Search messages")}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") toggleSearch(); }}
            style={{ width: 200, height: 28, padding: "0 10px" }}
          />
        )}
        {!searchOpen && participants.length > 0 && <AvatarStack names={participants.slice(0, 5)} bot />}
        <IconButton icon="search" label={t("Search")} onClick={toggleSearch} />
      </div>
    </header>
  );
}
