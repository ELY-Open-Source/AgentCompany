import { useState, type FormEvent } from "react";
import { Button, Icon, IconButton, Pill } from "../../shared/ui";
import type {
  BoardInterventionRecord,
  ChatAttachmentRecord,
  ChatMentionRecord,
  ChatMessageRecord,
  ChatSlashInvocationRecord,
  ChatThreadRecord,
  FileObjectRecord,
} from "../../../../shared/domain";
import { formatTime } from "../types";
import { ChatMessageRow } from "./ChatMessageRow";
import { MentionTextarea } from "./MentionTextarea";
import type { MessageContext } from "./chat-helpers";

/**
 * Thread focus, in place: the center pane narrows to one thread — root,
 * replies, board controls, and a reply composer — and the back control
 * returns to the conversation. No side panel duplicating the timeline.
 */
export function ChatThreadView({
  thread,
  rootMessage,
  messages,
  attachments,
  mentions,
  slashInvocations,
  boardInterventions,
  files,
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
    <section style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "var(--panel)" }}>
      <header className="row" style={{ height: 52, padding: "0 16px", borderBottom: "1px solid var(--border-soft)", flexShrink: 0, gap: 10 }}>
        <IconButton icon="chevronLeft" label="Close thread" onClick={onClose} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>Thread</span>
        <Pill tone={boardStateTone(thread.boardState)}>{boardStateLabel(thread.boardState)}</Pill>
      </header>
      <div style={{ flex: 1, overflow: "auto", padding: "20px 24px 8px" }}>
        <BoardControl
          thread={thread}
          interventions={boardInterventions}
          context={context}
          canIntervene={canIntervene}
          onSubmit={onBoardSubmit}
        />
        {rootMessage && (
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
          />
        )}
        {messages.length > 0 && (
          <div className="row" style={{ gap: 12, margin: "4px 0 16px" }}>
            <div style={{ flex: 1, height: 1, background: "var(--border-soft)" }} />
            <div style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 540 }}>
              {messages.length} {messages.length === 1 ? "reply" : "replies"}
            </div>
            <div style={{ flex: 1, height: 1, background: "var(--border-soft)" }} />
          </div>
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
          />
        ))}
      </div>
      <form onSubmit={onSubmit} style={{ padding: "0 24px 16px", flexShrink: 0 }}>
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
                <Icon name="file" size={14} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachment.name}</span>
                <button
                  type="button"
                  aria-label="Remove thread attachment"
                  onClick={() => onAttachmentChange("")}
                  style={{ display: "inline-flex", border: 0, background: "transparent", padding: 0, color: "var(--text-3)", cursor: "pointer" }}
                >
                  <Icon name="x" size={14} />
                </button>
              </span>
            )}
            <div style={{ marginLeft: "auto" }}>
              <Button tone="primary" size="small" type="submit"><Icon name="send" size={12} /> Reply</Button>
            </div>
          </div>
        </div>
      </form>
    </section>
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
    <section style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10, background: "var(--panel)", marginBottom: 16, maxWidth: 480 }}>
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
                <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>{formatTime(intervention.createdAt)}</span>
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
