import { useRef, useState, type PointerEvent } from "react";
import { Avatar, Icon, IconButton } from "../../shared/ui";
import type { ChatPresenceRecord } from "../../../../shared/domain";
import { formatRelative } from "../types";
import type { ConversationItem } from "./chat-helpers";
import { t } from "../../i18n/i18n";

const PANE_WIDTH_KEY = "agentcompany:chat-pane-width";
const PANE_MIN_W = 200;
const PANE_MAX_W = 480;

function storedPaneWidth(): number {
  const raw = Number(window.localStorage.getItem(PANE_WIDTH_KEY));
  if (!Number.isFinite(raw) || raw === 0) return 240;
  return Math.min(PANE_MAX_W, Math.max(PANE_MIN_W, raw));
}

function presenceColor(status: string | undefined): string | null {
  switch (status) {
    case "active":
    case "online":
      return "var(--green)";
    case "waiting_approval":
    case "busy":
      return "var(--amber)";
    case "thinking":
      return "var(--accent)";
    default:
      return null;
  }
}

/**
 * The conversation list: every channel and direct conversation is one row —
 * avatar, name, last-message preview, time, unread — newest first, the way
 * messengers do it.
 */
export function ChatSidebar({
  conversations,
  presence,
  activeSpaceId,
  onSelect,
  onCreateSpace,
}: {
  conversations: ConversationItem[];
  presence: ChatPresenceRecord[];
  activeSpaceId: string | null;
  onSelect: (spaceId: string) => void;
  onCreateSpace: () => void;
}) {
  const presenceByPrincipal = new Map(presence.map((entry) => [entry.principalId, entry.status]));

  // The list/conversation split is adjustable: drag the right edge, width
  // persists across sessions.
  const [paneWidth, setPaneWidth] = useState(storedPaneWidth);
  const dragStart = useRef<{ pointerX: number; width: number } | null>(null);
  const onHandleDown = (event: PointerEvent<HTMLDivElement>) => {
    dragStart.current = { pointerX: event.clientX, width: paneWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onHandleMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    const next = Math.min(PANE_MAX_W, Math.max(PANE_MIN_W, dragStart.current.width + event.clientX - dragStart.current.pointerX));
    setPaneWidth(next);
  };
  const onHandleUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    dragStart.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    window.localStorage.setItem(PANE_WIDTH_KEY, String(paneWidth));
  };

  return (
    <aside className="secondary-pane" style={{ width: paneWidth, position: "relative" }}>
      <div className="row" style={{ padding: "4px 8px 12px" }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{t("Messages")}</div>
        <IconButton icon="plus" label={t("New space")} onClick={onCreateSpace} />
      </div>
      <div className="pane-scroll">
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {conversations.map((conversation) => (
            <ConversationRow
              key={conversation.space.id}
              conversation={conversation}
              active={conversation.space.id === activeSpaceId}
              presenceStatus={conversation.counterpart ? presenceByPrincipal.get(conversation.counterpart.id) : undefined}
              onClick={() => onSelect(conversation.space.id)}
            />
          ))}
        </div>
      </div>
      <div
        className="pane-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("Resize conversation list")}
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
      />
    </aside>
  );
}

function ConversationRow({
  conversation,
  active,
  presenceStatus,
  onClick,
}: {
  conversation: ConversationItem;
  active: boolean;
  presenceStatus: string | undefined;
  onClick: () => void;
}) {
  const dotColor = presenceColor(presenceStatus);
  return (
    <button
      type="button"
      className={`convo-item ${active ? "active" : ""}`.trim()}
      onClick={onClick}
    >
      {conversation.isDirect ? (
        <span className="presence" style={{ marginTop: 2 }}>
          <Avatar name={conversation.counterpart?.name ?? conversation.title} size="sm" bot={conversation.counterpart?.type !== "employee"} />
          {dotColor && <span className="presence-dot" style={{ background: dotColor }} />}
        </span>
      ) : (
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: "var(--panel-3)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            marginTop: 2,
          }}
        >
          <Icon name={conversation.space.visibility === "restricted" ? "lock" : "hash"} size={13} color="var(--text-3)" />
        </span>
      )}
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        <span className="row" style={{ gap: 8 }}>
          <span
            style={{
              fontWeight: conversation.unread > 0 ? 600 : 520,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
              minWidth: 0,
            }}
          >
            {conversation.title}
          </span>
          {conversation.isCeo && <span className="convo-ceo-badge">{t("CEO")}</span>}
          <span style={{ fontSize: 11, color: "var(--text-3)", flexShrink: 0 }}>
            {conversation.preview ? formatRelative(conversation.lastActivityAt) : ""}
          </span>
        </span>
        <span className="row" style={{ gap: 8 }}>
          <span
            style={{
              fontSize: 12,
              color: "var(--text-3)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
              minWidth: 0,
            }}
          >
            {conversation.preview ?? (conversation.isCeo ? t("Ask about progress, goals, or direction") : conversation.space.topic)}
          </span>
          {conversation.unread > 0 && (
            <span className="nav-badge" style={{ flexShrink: 0 }}>{conversation.unread > 99 ? "99+" : conversation.unread}</span>
          )}
        </span>
      </span>
    </button>
  );
}
