import { Avatar, Icon, IconButton } from "../../shared/ui";
import type { ChatPresenceRecord } from "../../../../shared/domain";
import { formatRelative } from "../types";
import type { ConversationItem } from "./chat-helpers";

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
  return (
    <aside className="secondary-pane">
      <div className="row" style={{ padding: "4px 8px 12px" }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Messages</div>
        <IconButton icon="plus" label="New space" onClick={onCreateSpace} />
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
            {conversation.preview ?? conversation.space.topic}
          </span>
          {conversation.unread > 0 && (
            <span className="nav-badge" style={{ flexShrink: 0 }}>{conversation.unread > 99 ? "99+" : conversation.unread}</span>
          )}
        </span>
      </span>
    </button>
  );
}
