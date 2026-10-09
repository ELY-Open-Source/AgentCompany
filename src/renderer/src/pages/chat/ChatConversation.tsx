import { useLeaveGuard } from "../../app/leave-guard";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type MutableRefObject } from "react";
import { Avatar, AvatarStack, Icon, IconButton } from "../../shared/ui";
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
import type { ChatReplyStatus, SpaceHistoryPage } from "../../../../shared/chat-domain";

/** Older messages fetched per "Show earlier messages". */
const HISTORY_PAGE = 150;
import { spaceReaders, type MessageContext, type SpaceMember } from "./chat-helpers";
import { Popover } from "../../shared/Popover";
import { t } from "../../i18n/i18n";

export function ChatConversation({
  space,
  members,
  messagesInSpace,
  threads,
  replyStatuses,
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
  members: SpaceMember[];
  messagesInSpace: ChatMessageRecord[];
  threads: ChatThreadRecord[];
  replyStatuses: ChatReplyStatus[];
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
  onEditMessage: (messageId: string, bodyMd: string) => Promise<void>;
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
  // A reply typed in one thread is lost by opening another or closing the panel.
  const requestLeave = useLeaveGuard();
  // The snapshot holds recent chat only; older messages come from the database, paged back from the oldest one loaded.
  const [oldestId, setOldestId] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [older, setOlder] = useState<SpaceHistoryPage | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const anchorId = messagesInSpace.length > 0 ? messagesInSpace[0].id : null;
  const orgId = space?.orgId ?? null;
  const currentSpaceId = space?.id ?? null;
  const loadOlder = useCallback(() => {
    if (!orgId || !currentSpaceId) return;
    window.agentCompany.chatSpaceHistory({ orgId, spaceId: currentSpaceId, beforeMessageId: oldestId ?? anchorId, limit: HISTORY_PAGE }).then((result) => {
      if (!result.ok) throw new Error(result.error.message);
      // With nothing older, the oldest message already shown is pinned, so the range refresh keeps it if newer traffic displaces it.
      const oldest = result.data.messages.length > 0 ? result.data.messages[0].id : oldestId ?? anchorId;
      if (oldest !== null) setOldestId(oldest);
      setExhausted(!result.data.hasMore);
      setHistoryError(null);
    }).catch((reason: unknown) => setHistoryError(reason instanceof Error ? reason.message : String(reason)));
  }, [orgId, currentSpaceId, oldestId, anchorId]);
  // While the snapshot holds none of the conversation and nothing is pinned, every reload checks the database for its newest page.
  useEffect(() => {
    if (messagesInSpace.length === 0 && oldestId === null) loadOlder();
  }, [messagesInSpace, oldestId, loadOlder]);
  useEffect(() => {
    if (!orgId || !currentSpaceId || !oldestId) return;
    let cancelled = false;
    // The loaded range is refetched on every snapshot reload (messagesInSpace changes), so edits and deletes of old messages show too.
    window.agentCompany.chatSpaceHistory({ orgId, spaceId: currentSpaceId, beforeMessageId: anchorId, fromMessageId: oldestId }).then((result) => {
      if (cancelled) return;
      if (!result.ok) throw new Error(result.error.message);
      setOlder(result.data);
      setExhausted(!result.data.hasMore);
      setHistoryError(null);
    }).catch((reason: unknown) => {
      if (!cancelled) setHistoryError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      cancelled = true;
    };
  }, [orgId, currentSpaceId, oldestId, anchorId, messagesInSpace]);
  const allMessages = useMemo(() => [...(older?.messages ?? []), ...messagesInSpace], [older, messagesInSpace]);
  const allThreads = useMemo(() => {
    const byId = new Map(threads.map((thread) => [thread.id, thread]));
    for (const thread of older?.threads ?? []) if (!byId.has(thread.id)) byId.set(thread.id, thread);
    return [...byId.values()];
  }, [threads, older]);
  // Paged messages take their attachments, mentions and commands from the page only, so a record the snapshot also holds is not doubled.
  const pagedIds = useMemo(() => new Set((older?.messages ?? []).map((message) => message.id)), [older]);
  const allAttachments = useMemo(() => [...(older?.attachments ?? []), ...attachments.filter((item) => !pagedIds.has(item.messageId))], [older, attachments, pagedIds]);
  const allMentions = useMemo(() => [...(older?.mentions ?? []), ...mentions.filter((item) => !pagedIds.has(item.messageId))], [older, mentions, pagedIds]);
  const allReplyStatuses = useMemo(
    () => [...(older?.replyStatuses ?? []), ...replyStatuses.filter((item) => !pagedIds.has(item.messageId))],
    [older, replyStatuses, pagedIds],
  );
  const allSlashInvocations = useMemo(
    () => [...(older?.slashInvocations ?? []), ...slashInvocations.filter((item) => !pagedIds.has(item.messageId))],
    [older, slashInvocations, pagedIds],
  );
  const threadLinks = useMemo(() => buildThreadLinks(allMessages, allThreads, context), [allMessages, allThreads, context]);
  const trimmed = query.trim().toLowerCase();
  const filtered = trimmed
    ? allMessages.filter((m) => m.bodyMd.toLowerCase().includes(trimmed))
    : allMessages;

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
        {space && <ConversationHeader space={space} members={members} query={query} onQueryChange={setQuery} />}
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
                attachments={allAttachments}
                mentions={allMentions}
                slashInvocations={allSlashInvocations}
                files={files}
                context={context}
                currentEmployeeId={currentEmployeeId}
                historyStart={exhausted}
                historyError={historyError}
                onLoadOlder={loadOlder}
                threadLinks={threadLinks}
                replyStatuses={allReplyStatuses}
                onOpenThread={(threadId) => requestLeave(() => setOpenThreadId(threadId))}
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
          onClose={() => requestLeave(() => setOpenThreadId(null))}
          onOpenFile={onOpenFile}
        />
      )}
    </>
  );
}

function ConversationHeader({
  space,
  members,
  query,
  onQueryChange,
}: {
  space: ChatSpaceRecord;
  members: SpaceMember[];
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
        {!searchOpen && <MembersButton space={space} members={members} />}
        <IconButton icon="search" label={t("Search")} onClick={toggleSearch} />
      </div>
    </header>
  );
}

/** The real member list: who is in the conversation, how each agent replies, and who else can read it. */
function MembersButton({ space, members }: { space: ChatSpaceRecord; members: SpaceMember[] }) {
  return (
    <Popover
      trigger={({ toggle }) => (
        <button type="button" onClick={toggle} aria-label={t("Members ({count})", { count: String(members.length) })} style={{ display: "flex", alignItems: "center", gap: 6, border: 0, background: "transparent", cursor: "pointer", padding: 0 }}>
          <AvatarStack names={members.slice(0, 5).map((member) => member.name)} />
          <span style={{ fontSize: 12, color: "var(--text-3)" }}>{members.length}</span>
        </button>
      )}
    >
      {() => (
        // A large roster scrolls inside the window instead of running past it.
        <div className="members-roster" style={{ padding: 12, width: 320, maxHeight: "min(480px, calc(100vh - 120px))", overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, color: "var(--text-3)" }}>{spaceReaders(space)}</div>
          {members.map((member) => (
            <div key={member.id} className="row" style={{ gap: 8, alignItems: "flex-start" }}>
              <Avatar name={member.name} size="sm" bot={member.bot} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 540 }}>{member.name}</div>
                <div style={{ fontSize: 12, color: "var(--text-3)" }}>{member.duty}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Popover>
  );
}
