import type { ReactNode } from "react";
import { Avatar, Icon, IconButton } from "../../shared/ui";
import type { AgentRecord, ChatMessageRecord, ChatSpaceRecord } from "../../../../shared/domain";
import { countMessagesIn } from "./chat-helpers";

export function ChatSidebar({
  channels,
  directs,
  agents,
  messages,
  activeSpaceId,
  onSelect,
  onCreateSpace,
}: {
  channels: ChatSpaceRecord[];
  directs: ChatSpaceRecord[];
  agents: AgentRecord[];
  messages: ChatMessageRecord[];
  activeSpaceId: string | null;
  onSelect: (spaceId: string) => void;
  onCreateSpace: () => void;
}) {
  return (
    <aside className="secondary-pane">
      <div className="row" style={{ padding: "4px 8px 12px" }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Messages</div>
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
      <div style={{ fontSize: 11, color: "var(--text-3)", padding: "6px 8px", fontWeight: 540, letterSpacing: "0.02em" }}>{label}</div>
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
      <Icon name={space.visibility === "restricted" ? "lock" : "hash"} size={13} color={active ? "var(--text-1)" : "var(--text-3)"} />
      <span>{space.name}</span>
      {count > 0 && <span className="nav-badge">{count}</span>}
    </button>
  );
}

function DirectItem({
  space,
  agents,
  active,
  count,
  onClick,
}: {
  space: ChatSpaceRecord;
  agents: AgentRecord[];
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  const counterpart = agents.find((agent) => space.name.includes(agent.name));
  return (
    <button type="button" className={`nav-item ${active ? "active" : ""}`.trim()} onClick={onClick}>
      {counterpart ? <Avatar name={counterpart.name} size="sm" bot /> : <Icon name="user" size={13} />}
      <span>{space.name}</span>
      {count > 0 && <span className="nav-badge">{count}</span>}
    </button>
  );
}
