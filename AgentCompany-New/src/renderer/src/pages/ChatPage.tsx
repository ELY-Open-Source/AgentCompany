import { useState, type FormEvent, type ReactNode } from "react";
import { Avatar, Button, Field, Icon, IconButton } from "../shared/ui";
import { Dialog } from "../shared/Dialog";
import type { ChatAttachmentRecord, ChatSpaceRecord, ChatThreadRecord, FileObjectRecord } from "../../../shared/domain";
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
  const files = snapshot.files.filter((item) => item.orgId === orgId);
  const [spaceId, setSpaceId] = useState(spaces[0]?.id ?? "");
  const [spaceOpen, setSpaceOpen] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const activeSpace = spaces.find((space) => space.id === spaceId) ?? spaces[0];
  if (!activeSpace) throw new Error("At least one chat space is required.");
  const messages = snapshot.chatMessages.filter((item) => item.orgId === orgId && item.spaceId === activeSpace.id);
  const rootMessages = messages.filter((m) => m.threadId === null);
  const threads = snapshot.chatThreads.filter((t) => t.spaceId === activeSpace.id);
  const selectedThread = threads.find((t) => t.id === selectedThreadId) ?? null;
  const threadMessages = selectedThread ? messages.filter((m) => m.threadId === selectedThread.id) : [];
  const sender = employees[0];

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeSpace || !sender) return;
    const form = new FormData(event.currentTarget);
    const bodyMd = messageBody(form);
    if (!bodyMd) return;
    event.currentTarget.reset();
    const attachmentFileId = value(form, "attachmentFileId");
    void actions.run(() => window.agentCompany.sendMessage({
      orgId,
      spaceId: activeSpace.id,
      threadId: null,
      senderType: "employee",
      senderId: sender.id,
      bodyMd,
      attachmentFileIds: attachmentFileId ? [attachmentFileId] : [],
    }));
  };

  const submitReply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedThread || !sender) return;
    const form = new FormData(event.currentTarget);
    const bodyMd = messageBody(form);
    if (!bodyMd) return;
    event.currentTarget.reset();
    void actions.run(() => window.agentCompany.sendMessage({
      orgId,
      spaceId: activeSpace.id,
      threadId: selectedThread.id,
      senderType: "employee",
      senderId: sender.id,
      bodyMd,
      attachmentFileIds: [],
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
        <header className="row" style={{ height: 52, padding: "0 24px", borderBottom: "1px solid var(--border-soft)", flexShrink: 0 }}>
          <Icon name={activeSpace.visibility === "restricted" ? "lock" : "hash"} />
          <div style={{ fontSize: 14, fontWeight: 600 }}>{activeSpace.name}</div>
          <div style={{ color: "var(--text-3)", borderLeft: "1px solid var(--border)", paddingLeft: 10 }}>
            {activeSpace.topic}
          </div>
          <div style={{ marginLeft: "auto" }}><Icon name="search" /></div>
        </header>
        <div style={{ flex: 1, overflow: "auto", padding: "20px 24px 8px" }}>
          {rootMessages.length === 0 ? (
            <div style={{ color: "var(--text-3)" }}>No messages</div>
          ) : rootMessages.map((message) => {
            const thread = threads.find((t) => t.rootMessageId === message.id) ?? null;
            const replyCount = thread ? messages.filter((m) => m.threadId === thread.id).length : 0;
            return (
              <MessageRow
                key={message.id}
                body={message.bodyMd}
                time={new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                name={displayName(message.senderType, message.senderId, employees, agents)}
                bot={message.senderType === "agent"}
                files={messageFiles(message.id, snapshot.chatAttachments, files)}
                threadReplyCount={replyCount}
                onOpenThread={thread ? () => setSelectedThreadId(thread.id) : null}
              />
            );
          })}
        </div>
        <form onSubmit={submit} style={{ padding: 14, paddingTop: 4, flexShrink: 0 }}>
          <div className="card" style={{ padding: "10px 12px" }}>
            <textarea className="input" name="message" rows={2} aria-label="Message" />
            <div className="row" style={{ paddingTop: 8, borderTop: "1px solid var(--border-soft)" }}>
              <Icon name="attach" />
              <select className="input" name="attachmentFileId" aria-label="File attachment" style={{ maxWidth: 220 }}>
                <option value="">File</option>
                {files.map((file) => <option key={file.id} value={file.id}>{file.name}</option>)}
              </select>
              <div style={{ marginLeft: "auto" }}>
                <Button tone="primary" size="small" type="submit" disabled={!activeSpace || !sender}><Icon name="send" /> Send</Button>
              </div>
            </div>
          </div>
        </form>
      </section>

      {selectedThread && (
        <ThreadPanel
          thread={selectedThread}
          threadMessages={threadMessages}
          rootMessage={messages.find((m) => m.id === selectedThread.rootMessageId) ?? null}
          employees={employees}
          agents={agents}
          files={files}
          attachments={snapshot.chatAttachments}
          senderDisabled={!sender}
          onClose={() => setSelectedThreadId(null)}
          onSubmit={submitReply}
        />
      )}

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

function ThreadPanel({
  thread,
  threadMessages,
  rootMessage,
  employees,
  agents,
  files,
  attachments,
  senderDisabled,
  onClose,
  onSubmit,
}: {
  thread: ChatThreadRecord;
  threadMessages: Array<{ id: string; bodyMd: string; createdAt: string; senderType: string; senderId: string | null; threadId: string | null }>;
  rootMessage: { id: string; bodyMd: string; createdAt: string; senderType: string; senderId: string | null } | null;
  employees: Array<{ id: string; displayName: string }>;
  agents: Array<{ id: string; name: string }>;
  files: FileObjectRecord[];
  attachments: ChatAttachmentRecord[];
  senderDisabled: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <aside style={{ width: 320, flexShrink: 0, borderLeft: "1px solid var(--border-soft)", background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      <div className="row" style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-soft)", flexShrink: 0 }}>
        <span style={{ fontWeight: 600 }}>Thread</span>
        <div style={{ marginLeft: "auto" }}>
          <IconButton icon="x" label="Close thread" onClick={onClose} />
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
        {rootMessage && (
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, marginBottom: 16, background: "var(--panel)" }}>
            <MessageRow
              body={rootMessage.bodyMd}
              time={new Date(rootMessage.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              name={displayName(rootMessage.senderType, rootMessage.senderId, employees, agents)}
              bot={rootMessage.senderType === "agent"}
              files={messageFiles(rootMessage.id, attachments, files)}
              compact
            />
          </div>
        )}
        {threadMessages.map((message) => (
          <MessageRow
            key={message.id}
            body={message.bodyMd}
            time={new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            name={displayName(message.senderType, message.senderId, employees, agents)}
            bot={message.senderType === "agent"}
            files={messageFiles(message.id, attachments, files)}
            compact
          />
        ))}
      </div>
      <form onSubmit={onSubmit} style={{ padding: 12, flexShrink: 0 }}>
        <div className="card" style={{ padding: "8px 10px" }}>
          <textarea className="input" name="message" rows={2} aria-label="Thread reply" />
          <div style={{ paddingTop: 6, display: "flex", justifyContent: "flex-end" }}>
            <Button tone="primary" size="small" type="submit" disabled={senderDisabled}><Icon name="send" /> Reply</Button>
          </div>
        </div>
      </form>
    </aside>
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
    <button type="button" aria-label={space.name} className={`nav-item ${active ? "active" : ""}`} onClick={onClick}>
      <Icon name={space.visibility === "restricted" ? "lock" : "hash"} />
      <span>{space.name}</span>
      {count > 0 && <span className="nav-badge">{count}</span>}
    </button>
  );
}

function MessageRow({
  name,
  body,
  time,
  bot,
  files,
  threadReplyCount = 0,
  onOpenThread,
  compact = false,
}: {
  name: string;
  body: string;
  time: string;
  bot: boolean;
  files: FileObjectRecord[];
  threadReplyCount?: number;
  onOpenThread?: (() => void) | null;
  compact?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: compact ? 10 : 12, marginBottom: compact ? 12 : 18 }}>
      <Avatar name={name} bot={bot} size={compact ? "sm" : ""} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="row" style={{ alignItems: "baseline", marginBottom: 2 }}>
          <span style={{ fontWeight: 540 }}>{name}</span>
          <span className="num" style={{ color: "var(--text-3)", fontSize: 11 }}>{time}</span>
        </div>
        <div style={{ lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{body}</div>
        {files.length > 0 && (
          <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
            {files.map((file) => (
              <span key={file.id} className="attachment-pill">
                <Icon name="file" size={13} /> {file.name}
              </span>
            ))}
          </div>
        )}
        {threadReplyCount > 0 && onOpenThread && (
          <button
            type="button"
            onClick={onOpenThread}
            style={{
              marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6,
              fontSize: 11.5, color: "var(--accent)", cursor: "pointer",
              padding: "3px 8px", borderRadius: 6, background: "var(--accent-soft)",
              border: 0,
            }}
          >
            <Icon name="chat" size={11} /> {threadReplyCount} {threadReplyCount === 1 ? "reply" : "replies"} →
          </button>
        )}
      </div>
    </div>
  );
}

function messageFiles(
  messageId: string,
  attachments: ChatAttachmentRecord[],
  files: FileObjectRecord[],
): FileObjectRecord[] {
  return attachments
    .filter((attachment) => attachment.messageId === messageId)
    .map((attachment) => {
      const file = files.find((item) => item.id === attachment.fileId);
      if (!file) throw new Error("Chat attachment file is missing.");
      return file;
    });
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
