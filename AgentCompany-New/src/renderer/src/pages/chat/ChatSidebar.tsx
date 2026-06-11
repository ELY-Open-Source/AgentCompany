import type { ReactNode } from "react";
import { Avatar, Icon, IconButton } from "../../shared/ui";
import type { AgentRecord, ChatMessageRecord, ChatPresenceRecord, ChatSpaceRecord } from "../../../../shared/domain";
import { countMessagesIn } from "./chat-helpers";

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

export function ChatSidebar({
  channels,
  directs,
  agents,
  messages,
  presence,
  activeSpaceId,
  onSelect,
  onCreateSpace,
}: {
  channels: ChatSpaceRecord[];
  directs: ChatSpaceRecord[];
  agents: AgentRecord[];
  messages: ChatMessageRecord[];
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
        <NavGroup label="Channels">
          {channels.length === 0 ? (
            <Empty>No channels.</Empty>
          ) : channels.map((space) => (
            <ChannelItem
              key={space.id}
              space={space}
              active={space.id === activeSpaceId}
              count={countMessagesIn(space.id, messages)}
              onClick={() => onSelect(space.id)}
            />
          ))}
        </NavGroup>
        {directs.length > 0 && (
          <NavGroup label="Direct">
            {directs.map((space) => (
              <DirectItem
                key={space.id}
                space={space}
                agents={agents}
                presenceByPrincipal={presenceByPrincipal}
                active={space.id === activeSpaceId}
                count={countMessagesIn(space.id, messages)}
                onClick={() => onSelect(space.id)}
              />
            ))}
          </NavGroup>
        )}
      </div>
    </aside>
  );
}

function NavGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 12, color: "var(--text-3)", padding: "6px 8px", fontWeight: 540, letterSpacing: "0.02em" }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>{children}</div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div style={{ padding: "4px 8px", color: "var(--text-3)", fontSize: 12 }}>{children}</div>;
}

function ChannelItem({
  space,
  active,
  count,
  onClick,
}: {
  space: ChatSpaceRecord;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`nav-item ${active ? "active" : ""}`.trim()} onClick={onClick}>
      <Icon name={space.visibility === "restricted" ? "lock" : "hash"} size={16} color={active ? "var(--text-1)" : "var(--text-3)"} />
      <span>{space.name}</span>
      {count > 0 && <span className="nav-badge">{count}</span>}
    </button>
  );
}

function DirectItem({
  space,
  agents,
  presenceByPrincipal,
  active,
  count,
  onClick,
}: {
  space: ChatSpaceRecord;
  agents: AgentRecord[];
  presenceByPrincipal: Map<string, string>;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  const counterpart = agents.find((agent) => space.name.includes(agent.name));
  const dotColor = counterpart ? presenceColor(presenceByPrincipal.get(counterpart.id)) : null;
  return (
    <button type="button" className={`nav-item ${active ? "active" : ""}`.trim()} onClick={onClick}>
      {counterpart ? (
        <span className="presence">
          <Avatar name={counterpart.name} size="sm" bot />
          {dotColor && <span className="presence-dot" style={{ background: dotColor }} />}
        </span>
      ) : (
        <Icon name="user" size={16} />
      )}
      <span>{space.name}</span>
      {count > 0 && <span className="nav-badge">{count}</span>}
    </button>
  );
}
