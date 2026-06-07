import { useState, type FormEvent } from "react";
import { Button, Icon, IconButton, Pill } from "../../shared/ui";
import type {
  AuditEventRecord,
  BoardInterventionRecord,
  ChatAttachmentRecord,
  ChatMentionRecord,
  ChatMessageRecord,
  ChatSlashInvocationRecord,
  ChatThreadRecord,
  FileObjectRecord,
} from "../../../../shared/domain";
import { auditEventLabel, formatTime } from "../types";
import { ChatMessageRow } from "./ChatMessageRow";
import { MentionTextarea } from "./MentionTextarea";
import { senderName, type MessageContext } from "./chat-helpers";

export function ChatThreadPanel({
  thread,
  rootMessage,
  messages,
  attachments,
  mentions,
  slashInvocations,
  boardInterventions,
  files,
  auditEvents,
  context,
  canIntervene,
  attachmentFileId,
  onClose,
  onAttachmentChange,
  onAttach,
  onSubmit,
  onBoardSubmit,
  onOpenFile,
}: {
  thread: ChatThreadRecord;
  rootMessage: ChatMessageRecord | null;
  messages: ChatMessageRecord[];
  attachments: ChatAttachmentRecord[];
  mentions: ChatMentionRecord[];
  slashInvocations: ChatSlashInvocationRecord[];
  boardInterventions: BoardInterventionRecord[];
  files: FileObjectRecord[];
  auditEvents: AuditEventRecord[];
  context: MessageContext;
  canIntervene: boolean;
  attachmentFileId: string;
  onClose: () => void;
  onAttachmentChange: (next: string) => void;
  onAttach: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onBoardSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onOpenFile: (fileId: string) => void;
}) {
  const attachment = files.find((file) => file.id === attachmentFileId) ?? null;
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
        <Pill tone={boardStateTone(thread.boardState)}>{boardStateLabel(thread.boardState)}</Pill>
        <div style={{ marginLeft: "auto" }}>
          <IconButton icon="x" label="Close thread" onClick={onClose} />
        </div>
      </div>
      <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
        <BoardControl
          thread={thread}
          interventions={boardInterventions}
          context={context}
          canIntervene={canIntervene}
          onSubmit={onBoardSubmit}
        />
        {rootMessage && (
          <>
            <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 10 }}>
              {formatTime(rootMessage.createdAt)} · {senderName(rootMessage, context)}
            </div>
            <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, background: "var(--panel)", marginBottom: 16 }}>
              <ChatMessageRow
                message={rootMessage}
                attachments={attachments}
                mentions={mentions}
                slashInvocations={slashInvocations}
                files={files}
                replyCount={0}
                onOpenThread={null}
                context={context}
                onOpenFile={onOpenFile}
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
            mentions={mentions}
            slashInvocations={slashInvocations}
            files={files}
            replyCount={0}
            onOpenThread={null}
            context={context}
            onOpenFile={onOpenFile}
            compact
          />
        ))}
        {auditEvents.length > 0 && <AuditReplay events={auditEvents} />}
      </div>
      <form onSubmit={onSubmit} style={{ padding: 12, flexShrink: 0 }}>
        <div style={{ border: "1px solid var(--border-strong)", borderRadius: 10, background: "var(--panel)", padding: "8px 10px" }}>
          <MentionTextarea
            name="message"
            rows={2}
            ariaLabel="Thread reply"
            agents={context.agents}
            employees={context.employees}
            style={{ minHeight: 36 }}
          />
          <div className="row" style={{ paddingTop: 6, gap: 4 }}>
            <IconButton icon="attach" label="Attach file" onClick={onAttach} />
            {attachment && (
              <span className="pill" style={{ maxWidth: 150 }}>
                <Icon name="file" size={11} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachment.name}</span>
                <button
                  type="button"
                  aria-label="Remove thread attachment"
                  onClick={() => onAttachmentChange("")}
                  style={{ display: "inline-flex", border: 0, background: "transparent", padding: 0, color: "var(--text-3)", cursor: "pointer" }}
                >
                  <Icon name="x" size={11} />
                </button>
              </span>
            )}
            <div style={{ marginLeft: "auto" }}>
              <Button tone="primary" size="small" type="submit"><Icon name="send" size={12} /> Reply</Button>
            </div>
          </div>
        </div>
      </form>
    </aside>
  );
}

function BoardControl({
  thread,
  interventions,
  context,
  canIntervene,
  onSubmit,
}: {
  thread: ChatThreadRecord;
  interventions: BoardInterventionRecord[];
  context: MessageContext;
  canIntervene: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [action, setAction] = useState("decision");
  if (!canIntervene && interventions.length === 0) return null;
  return (
    <section style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10, background: "var(--panel)", marginBottom: 16 }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <div className="section-label">Board</div>
        <Pill tone={boardStateTone(thread.boardState)}>{boardStateLabel(thread.boardState)}</Pill>
      </div>
      {canIntervene && (
      <form onSubmit={onSubmit} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <label className="field" style={{ margin: 0 }}>
          <span>Action</span>
          <select className="input" name="action" value={action} onChange={(event) => setAction(event.target.value)}>
            <option value="decision">Decision</option>
            <option value="freeze">Freeze</option>
            <option value="takeover">Takeover</option>
            <option value="rollback">Rollback</option>
            <option value="force-approval">Force approval</option>
          </select>
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span>Target</span>
          <select className="input" name="target" defaultValue="board" disabled={action !== "takeover"}>
            <option value="board">Board</option>
            {context.employees.map((employee) => (
              <option key={employee.id} value={employee.id}>Employee · {employee.displayName}</option>
            ))}
            {context.agents.map((agent) => (
              <option key={agent.id} value={agent.id}>Agent · {agent.name}</option>
            ))}
          </select>
        </label>
        <label className="field" style={{ gridColumn: "1 / -1", margin: 0 }}>
          <span>Details</span>
          <input className="input" name="details" required aria-label="Board intervention details" />
        </label>
        <div className="row" style={{ gridColumn: "1 / -1", justifyContent: "flex-end" }}>
          <Button tone="primary" size="small" type="submit"><Icon name="shield" size={12} /> Board</Button>
        </div>
      </form>
      )}
      {interventions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 10 }}>
          {interventions.map((intervention) => (
            <div key={intervention.id} style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 7 }}>
              <div className="row" style={{ gap: 6, marginBottom: 3 }}>
                <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{formatTime(intervention.createdAt)}</span>
                <Pill tone={intervention.mode === "takeover" ? "violet" : intervention.action === "freeze" ? "red" : undefined}>
                  {formatBoardAction(intervention.action)}
                </Pill>
              </div>
              <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.4, wordBreak: "break-word" }}>{intervention.details}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function boardStateTone(state: string): "red" | "violet" | undefined {
  if (state === "frozen") return "red";
  if (state === "takeover") return "violet";
  return undefined;
}

function boardStateLabel(state: string): string {
  if (state === "frozen") return "Frozen";
  if (state === "takeover") return "Takeover";
  return "Open";
}

function formatBoardAction(action: string): string {
  return action.replace(/_/g, " ");
}

function AuditReplay({ events }: { events: AuditEventRecord[] }) {
  return (
    <section style={{ borderTop: "1px solid var(--border-soft)", marginTop: 18, paddingTop: 14 }}>
      <div className="section-label" style={{ marginBottom: 10 }}>Audit</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {events.map((event) => (
          <div
            key={event.id}
            className="row"
            style={{
              alignItems: "baseline",
              gap: 8,
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "8px 10px",
              background: "var(--panel)",
              minWidth: 0,
            }}
          >
            <span className="mono" style={{ fontSize: 11, color: "var(--text-3)", flexShrink: 0 }}>{formatTime(event.createdAt)}</span>
            <span style={{ fontSize: 12, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {auditEventLabel(event.entityType, event.action)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
