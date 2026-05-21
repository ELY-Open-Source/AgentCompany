import { useState, type FormEvent, type ReactNode } from "react";
import { Avatar, Button, Field, Icon, IconButton } from "../shared/ui";
import { Dialog } from "../shared/Dialog";
import type { ChatSpaceRecord } from "../../../shared/domain";
import type { PageProps } from "./types";
import { activeOrgId } from "./types";

function messageBody(form: FormData): string {
  return String(form.get("message") ?? "").trim();
}

function value(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

export function ChatPage({ snapshot, actions }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const spaces = snapshot.chatSpaces.filter((item) => item.orgId === orgId);
  const employees = snapshot.employees.filter((item) => item.orgId === orgId);
  const agents = snapshot.agents.filter((item) => item.orgId === orgId);
  const [spaceId, setSpaceId] = useState(spaces[0]?.id ?? "");
  const [spaceOpen, setSpaceOpen] = useState(false);
  const activeSpace = spaces.find((space) => space.id === spaceId) ?? spaces[0];
  const messages = snapshot.chatMessages.filter((item) => item.orgId === orgId && item.spaceId === activeSpace?.id);
  const sender = employees[0];

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeSpace || !sender) return;
    const form = new FormData(event.currentTarget);
    const bodyMd = messageBody(form);
    if (!bodyMd) return;
    event.currentTarget.reset();
    void actions.run(() => window.agentCompany.sendMessage({
      orgId,
      spaceId: activeSpace.id,
      threadId: null,
      senderType: "employee",
      senderId: sender.id,
      bodyMd,
    }));
  };

  const createSpace = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void actions.run(() => window.agentCompany.createChatSpace({
      orgId,
      spaceType: value(form, "spaceType") as "company" | "department" | "project" | "direct",
      name: value(form, "name"),
      topic: value(form, "topic"),
      visibility: value(form, "visibility") as "workspace" | "restricted",
    })).then(() => setSpaceOpen(false));
  };

  return (
    <div className="split-main" style={{ height: "calc(100vh - 112px)", margin: "-28px -32px -40px" }}>
      <aside className="secondary-pane">
        <div className="row" style={{ padding: "4px 8px 12px" }}>
          <div style={{ fontWeight: 600 }}>Messages</div>
          <IconButton icon="plus" label="New space" onClick={() => setSpaceOpen(true)} />
        </div>
        <NavGroup label="Channels">
          {spaces.length === 0 ? <div className="nav-item">No channels</div> : spaces.map((space) => (
            <SpaceItem
              key={space.id}
              space={space}
              active={activeSpace?.id === space.id}
              count={snapshot.chatMessages.filter((message) => message.spaceId === space.id).length}
              onClick={() => setSpaceId(space.id)}
            />
          ))}
        </NavGroup>
        <NavGroup label="Agents">
          {agents.map((agent) => (
            <div key={agent.id} className="nav-item">
              <Avatar name={agent.name} size="sm" bot />
              <span>{agent.name}</span>
            </div>
          ))}
        </NavGroup>
      </aside>
      <section style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "var(--panel)" }}>
        <header className="row" style={{ height: 52, padding: "0 24px", borderBottom: "1px solid var(--border-soft)" }}>
          <Icon name={activeSpace?.visibility === "restricted" ? "lock" : "hash"} />
          <div style={{ fontSize: 14, fontWeight: 600 }}>{activeSpace?.name ?? "Messages"}</div>
          <div style={{ color: "var(--text-3)", borderLeft: "1px solid var(--border)", paddingLeft: 10 }}>
            {activeSpace?.topic ?? ""}
          </div>
          <div style={{ marginLeft: "auto" }}><Icon name="search" /></div>
        </header>
        <div style={{ flex: 1, overflow: "auto", padding: "20px 24px 8px" }}>
          {messages.length === 0 ? (
            <div style={{ color: "var(--text-3)" }}>No messages</div>
          ) : messages.map((message) => (
            <MessageRow
              key={message.id}
              body={message.bodyMd}
              time={new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              name={displayName(message.senderType, message.senderId, employees, agents)}
              bot={message.senderType === "agent"}
            />
          ))}
        </div>
        <form onSubmit={submit} style={{ padding: 14, paddingTop: 4 }}>
          <div className="card" style={{ padding: "10px 12px" }}>
            <textarea className="input" name="message" rows={2} aria-label="Message" />
            <div className="row" style={{ paddingTop: 8, borderTop: "1px solid var(--border-soft)" }}>
              <Icon name="attach" />
              <Icon name="social" />
              <div style={{ marginLeft: "auto" }}>
                <Button tone="primary" size="small" type="submit" disabled={!activeSpace || !sender}><Icon name="send" /> Send</Button>
              </div>
            </div>
          </div>
        </form>
      </section>
      <Dialog title="New space" open={spaceOpen} submitLabel="Create" onClose={() => setSpaceOpen(false)} onSubmit={createSpace}>
        <Field label="Name"><input className="input" name="name" required /></Field>
        <Field label="Topic"><input className="input" name="topic" required /></Field>
        <Field label="Type">
          <select className="input" name="spaceType" defaultValue="project">
            <option value="company">Company</option>
            <option value="department">Department</option>
            <option value="project">Project</option>
            <option value="direct">Direct</option>
          </select>
        </Field>
        <Field label="Visibility">
          <select className="input" name="visibility" defaultValue="workspace">
            <option value="workspace">Workspace</option>
            <option value="restricted">Restricted</option>
          </select>
        </Field>
      </Dialog>
    </div>
  );
}

function NavGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div className="section-label" style={{ padding: "0 8px", marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

function SpaceItem({
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
    <button type="button" className={`nav-item ${active ? "active" : ""}`} onClick={onClick}>
      <Icon name={space.visibility === "restricted" ? "lock" : "hash"} />
      <span>{space.name}</span>
      {count > 0 && <span className="nav-badge">{count}</span>}
    </button>
  );
}

function MessageRow({ name, body, time, bot }: { name: string; body: string; time: string; bot: boolean }) {
  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
      <Avatar name={name} bot={bot} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="row" style={{ alignItems: "baseline", marginBottom: 2 }}>
          <span style={{ fontWeight: 540 }}>{name}</span>
          <span className="num" style={{ color: "var(--text-3)", fontSize: 11 }}>{time}</span>
        </div>
        <div style={{ lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{body}</div>
      </div>
    </div>
  );
}

function displayName(
  senderType: string,
  senderId: string | null,
  employees: Array<{ id: string; displayName: string }>,
  agents: Array<{ id: string; name: string }>,
): string {
  if (senderType === "employee") {
    const employee = employees.find((item) => item.id === senderId);
    if (!employee) throw new Error("Message employee sender is missing.");
    return employee.displayName;
  }
  if (senderType === "agent") {
    const agent = agents.find((item) => item.id === senderId);
    if (!agent) throw new Error("Message agent sender is missing.");
    return agent.name;
  }
  if (senderType === "board") return "Board";
  return "System";
}
